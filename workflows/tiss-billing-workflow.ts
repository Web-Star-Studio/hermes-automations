import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { stepCountIs, type ModelMessage, type StepResult, type ToolSet } from "ai";
import { webSearch } from "@exalabs/ai-sdk";
import { DurableAgent } from "@workflow/ai/agent";
import { defineHook, getWritable } from "workflow";
import { z } from "zod";
import { buildOrizonBillingAgentInstructions } from "@/lib/agents/orizon-billing-agent-config";
import { loginToOrizonFature } from "@/lib/browser-adapters/orizon-fature";
import { db } from "@/lib/db";
import {
  jobFiles,
  jobs,
  platformCredentials,
  tissDocuments,
} from "@/lib/db/schema";
import { getGatewayModelId, getGatewayProviderOptions } from "@/lib/ai/gateway";
import { appendJobEvent } from "@/lib/jobs/events";
import { decryptSecret } from "@/lib/security/credentials";
import { readUploadBytes } from "@/lib/storage/read-upload";
import { extractXmlDocuments, parseTissXml, type TissSummary } from "@/lib/tiss/parser";

export type BillingWorkflowEvent = {
  type: string;
  message: string;
  jobId: string;
  payload?: Record<string, unknown>;
};

const billingValidationSchema = z.object({
  platformId: z.literal("orizon_fature"),
  platformCredentialId: z.string().min(1),
  validatedData: z.record(z.string(), z.unknown()).default({}),
});

export type BillingValidationPayload = z.infer<typeof billingValidationSchema>;

export const billingValidationHook = defineHook({
  schema: billingValidationSchema,
});

const maxAgentSteps = 14;

export async function tissBillingWorkflow(jobId: string) {
  "use workflow";

  const agent = createOrizonBillingAgent(jobId);

  await recordAgentStarted(jobId);

  const result = await agent.stream({
    messages: [
      {
        role: "user",
        content:
          "Execute o fluxo do job: ingerir TISS, resumir para validacao humana, pausar ate aprovacao, preparar Browserbase, fazer login no Orizon Fature com a ferramenta segura e finalizar.",
      },
    ] satisfies ModelMessage[],
    writable: getWritable(),
    stopWhen: stepCountIs(maxAgentSteps),
    providerOptions: getGatewayProviderOptions({
      userId: await getJobUserId(jobId),
      feature: "browser-agent",
      tags: [`job:${jobId}`],
    }),
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: "hermes-billing-agent",
      metadata: { jobId },
    },
    onStepFinish: async (step) => {
      await recordAgentStep(jobId, step as StepResult<ToolSet>);
    },
  });

  const finalText = result.steps.at(-1)?.text ?? "";
  await finalizeAgentRun(jobId, finalText);

  return { jobId, status: "agent_completed" };
}

function createOrizonBillingAgent(jobId: string) {
  return new DurableAgent({
    model: getGatewayModelId(),
    tools: {
      ingestTiss: {
        description:
          "Extrai deterministicamente o arquivo XML/ZIP TISS enviado e grava um resumo estruturado para validacao.",
        inputSchema: z.object({}),
        execute: async () => ingestTissTool(jobId),
      },
      requestHumanValidation: {
        description:
          "Pausa o workflow ate um humano validar os dados TISS e escolher a credencial Orizon.",
        inputSchema: z.object({
          summary: z
            .string()
            .describe("Resumo curto dos dados TISS, sem XML completo nem dados sensiveis desnecessarios."),
        }),
        execute: async (input, context) =>
          requestHumanValidationTool(jobId, input.summary, context.toolCallId),
      },
      fillOrizonCredentials: {
        description:
          "Ferramenta segura que descriptografa credenciais fora do contexto do modelo e executa o login Orizon. Nunca informe senha no input.",
        inputSchema: z.object({
          platformCredentialId: z.string().min(1),
          validatedData: z.record(z.string(), z.unknown()).default({}),
        }),
        execute: async (input) =>
          fillOrizonCredentialsTool(jobId, input.platformCredentialId, input.validatedData),
      },
      finalizeJob: {
        description:
          "Registra a conclusao estruturada do agente depois do login ou de uma falha recuperavel.",
        inputSchema: z.object({
          status: z.enum(["login_succeeded", "failed"]),
          summary: z.string().min(1),
        }),
        execute: async (input) => finalizeJobTool(jobId, input.status, input.summary),
      },
      webSearch: createSafeExaSearchTool(),
      ...createWorkflowSafeBrowserbaseTools(jobId),
    },
    instructions: buildOrizonBillingAgentInstructions(),
  });
}

function createWorkflowSafeBrowserbaseTools(jobId: string) {
  return {
    browserbase_stagehand_session_start: {
      description:
        "Prepara conceitualmente uma sessao Browserbase para o job. O login com credenciais reais ocorre somente em fillOrizonCredentials.",
      inputSchema: z.object({}),
      execute: async () => recordBrowserbaseSessionPrepared(jobId),
    },
    browserbase_stagehand_session_close: {
      description: "Fecha a etapa logica de sessao Browserbase do agente.",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, redacted: true }),
    },
    browserbase_stagehand_navigate: {
      description:
        "Registra intencao de navegacao publica. Nao use para preencher credenciais ou transportar dados sensiveis.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async (input: { url: string }) => ({
        ok: true,
        url: input.url,
        redacted: true,
        note: "Navegacao real do portal autenticado e feita pela ferramenta segura de credenciais.",
      }),
    },
    browserbase_stagehand_get_url: {
      description: "Retorna o alvo publico atual conhecido para o portal Orizon.",
      inputSchema: z.object({}),
      execute: async () => ({
        ok: true,
        url: "https://www.orizon.com.br",
        redacted: true,
      }),
    },
    browserbase_screenshot: {
      description: "Captura visual esta desabilitada no MVP para evitar vazamento de PHI.",
      inputSchema: z.object({}),
      execute: async () => ({
        ok: false,
        redacted: true,
        reason: "Screenshot desabilitado no MVP por politica de dados sensiveis.",
      }),
    },
    browserbase_stagehand_act: {
      description:
        "Acao de browser sem segredos. Para login Orizon, use exclusivamente fillOrizonCredentials.",
      inputSchema: z.object({ action: z.string().min(1) }),
      execute: async (input: { action: string }) => ({
        ok: true,
        action: input.action,
        redacted: true,
      }),
    },
    browserbase_stagehand_extract: {
      description: "Extracao de browser sem PHI. Retorna apenas metadados publicos no MVP.",
      inputSchema: z.object({ instruction: z.string().min(1) }),
      execute: async () => ({ ok: true, data: {}, redacted: true }),
    },
    browserbase_stagehand_observe: {
      description: "Observacao de browser sem PHI. Use apenas antes de autenticacao.",
      inputSchema: z.object({ instruction: z.string().min(1) }),
      execute: async () => ({ ok: true, observations: [], redacted: true }),
    },
    browserbase_stagehand_agent_execute: {
      description:
        "Execucao Browserbase agentica sem credenciais. O login autenticado usa fillOrizonCredentials.",
      inputSchema: z.object({ instruction: z.string().min(1) }),
      execute: async () => ({
        ok: true,
        redacted: true,
        note: "Execucao sensivel roteada para ferramenta segura.",
      }),
    },
  };
}

async function ingestTissTool(jobId: string): Promise<TissSummary> {
  "use step";

  const [file] = await db.select().from(jobFiles).where(eq(jobFiles.jobId, jobId)).limit(1);

  if (!file) {
    throw new Error("Arquivo do job nao encontrado.");
  }

  await emit(jobId, "agent_tool_called", "Agente iniciou extracao TISS.", {
    agentStep: "ingest_tiss",
    toolName: "ingestTiss",
    nodeId: "tiss_extraction",
    status: "running",
    redacted: true,
  });

  const bytes = await readUploadBytes(file.blobUrl);
  const [document] = extractXmlDocuments(file.fileName, bytes);
  const summary = parseTissXml(document.xml);

  await db
    .insert(tissDocuments)
    .values({
      id: randomUUID(),
      jobId,
      standardVersion: summary.standardVersion,
      transactionType: summary.transactionType,
      providerName: summary.providerName,
      providerRegister: summary.providerRegister,
      operatorRegister: summary.operatorRegister,
      batchNumber: summary.batchNumber,
      guideCount: summary.guideCount,
      totalAmount: summary.totalAmount,
      beneficiaryNames: summary.beneficiaryNames,
      rawSummary: summary.rawSummary,
    })
    .onConflictDoUpdate({
      target: tissDocuments.jobId,
      set: {
        standardVersion: summary.standardVersion,
        transactionType: summary.transactionType,
        providerName: summary.providerName,
        providerRegister: summary.providerRegister,
        operatorRegister: summary.operatorRegister,
        batchNumber: summary.batchNumber,
        guideCount: summary.guideCount,
        totalAmount: summary.totalAmount,
        beneficiaryNames: summary.beneficiaryNames,
        rawSummary: summary.rawSummary,
        updatedAt: new Date(),
      },
    });

  await emit(jobId, "agent_tool_completed", "Extracao TISS concluida.", {
    agentStep: "ingest_tiss",
    toolName: "ingestTiss",
    nodeId: "tiss_extraction",
    status: "success",
    redacted: true,
    fileName: file.fileName,
    standardVersion: summary.standardVersion,
    guideCount: summary.guideCount,
  });

  return {
    ...summary,
    rawSummary: {
      standardVersion: summary.standardVersion,
      transactionType: summary.transactionType,
      providerName: summary.providerName,
      batchNumber: summary.batchNumber,
      guideCount: summary.guideCount,
      totalAmount: summary.totalAmount,
    },
  };
}

async function recordAgentStarted(jobId: string) {
  "use step";

  await emit(jobId, "agent_started", "Agente Hermes iniciado.", {
    agentStep: "start",
    nodeId: "agent_review",
    status: "running",
    redacted: true,
  });
}

async function requestHumanValidationTool(
  jobId: string,
  summary: string,
  toolCallId: string,
) {
  const hook = billingValidationHook.create({ token: toolCallId });

  await markHumanValidationRequested(jobId, hook.token, summary, toolCallId);

  const validation = await hook;

  return {
    approved: true,
    platformId: validation.platformId,
    platformCredentialId: validation.platformCredentialId,
    validatedData: validation.validatedData,
  };
}

async function markHumanValidationRequested(
  jobId: string,
  token: string,
  summary: string,
  toolCallId: string,
) {
  "use step";

  await db
    .update(jobs)
    .set({
      status: "awaiting_validation",
      validationHookToken: token,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  await emit(jobId, "human_validation_requested", "Agente pausou para validacao humana.", {
    agentStep: "request_human_validation",
    toolName: "requestHumanValidation",
    toolCallId,
    nodeId: "human_validation",
    status: "awaiting_human",
    redacted: true,
    summary,
  });
}

async function fillOrizonCredentialsTool(
  jobId: string,
  platformCredentialId: string,
  validatedData: Record<string, unknown>,
) {
  "use step";

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

  if (!job) {
    throw new Error("Job nao encontrado.");
  }

  const [credential] = await db
    .select()
    .from(platformCredentials)
    .where(
      and(
        eq(platformCredentials.id, platformCredentialId),
        eq(platformCredentials.userId, job.userId),
      ),
    )
    .limit(1);

  if (!credential) {
    throw new Error("Credencial da plataforma nao encontrada.");
  }

  const [file] = await db.select().from(jobFiles).where(eq(jobFiles.jobId, jobId)).limit(1);

  if (!file) {
    throw new Error("Arquivo do job nao encontrado.");
  }

  if (!file.fileName.toLowerCase().endsWith(".zip")) {
    throw new Error("O portal Orizon Fature so aceita arquivos .zip; reenvie o lote compactado.");
  }

  const fileBytes = await readUploadBytes(file.blobUrl);

  await db
    .update(jobs)
    .set({
      status: "running",
      platformId: "orizon_fature",
      platformCredentialId,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  await db
    .update(tissDocuments)
    .set({ validatedData, updatedAt: new Date() })
    .where(eq(tissDocuments.jobId, jobId));

  await emit(jobId, "agent_tool_called", "Agente iniciou login seguro no Orizon.", {
    agentStep: "login_orizon",
    toolName: "fillOrizonCredentials",
    nodeId: "orizon_login",
    status: "running",
    redacted: true,
    usernameMasked: maskUsername(credential.username),
  });

  await emit(jobId, "browser_session_started", "Sessao Browserbase preparada para o Orizon.", {
    agentStep: "prepare_browser_session",
    toolName: "fillOrizonCredentials",
    nodeId: "browserbase_session",
    status: "running",
    redacted: true,
    runtime: resolveBrowserRuntime(),
  });

  const password = decryptSecret({
    encryptedValue: credential.encryptedPassword,
    iv: credential.iv,
    authTag: credential.authTag,
  });

  let result;
  try {
    result = await loginToOrizonFature({
      username: credential.username,
      password,
      jobId,
      tissFile: {
        fileName: file.fileName,
        bytes: Buffer.from(fileBytes),
        contentType: file.contentType,
      },
      onProgress: async (event) => {
        await emitSubmitProgress(jobId, event);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao iniciar sessao Browserbase.";

    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await emit(jobId, "browser_action_completed", "Sessao Browserbase falhou.", {
      agentStep: "login_orizon",
      toolName: "fillOrizonCredentials",
      nodeId: "browserbase_session",
      status: "failed",
      redacted: true,
    });

    await emit(jobId, "agent_tool_completed", message, {
      agentStep: "login_orizon",
      toolName: "fillOrizonCredentials",
      nodeId: "error",
      status: "failed",
      redacted: true,
    });

    throw error;
  }

  if (!result.ok) {
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: result.message,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await emit(jobId, "browser_action_completed", "Login Orizon falhou.", {
      agentStep: "login_orizon",
      toolName: "fillOrizonCredentials",
      nodeId: "orizon_login",
      status: "failed",
      redacted: true,
      mode: result.mode,
      finalUrl: result.finalUrl,
      sessionId: result.sessionId,
      debugUrl: result.debugUrl,
    });

    await emit(jobId, "agent_tool_completed", result.message, {
      agentStep: "login_orizon",
      toolName: "fillOrizonCredentials",
      nodeId: "error",
      status: "failed",
      redacted: true,
    });

    return {
      ok: false,
      status: "failed",
      message: result.message,
      usernameMasked: maskUsername(credential.username),
      mode: result.mode,
    };
  }

  await db
    .update(jobs)
    .set({
      status: "login_succeeded",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  await emit(jobId, "browser_action_completed", "Login Orizon concluido.", {
    agentStep: "login_orizon",
    toolName: "fillOrizonCredentials",
    nodeId: "orizon_login",
    status: "success",
    redacted: true,
    mode: result.mode,
    finalUrl: result.finalUrl,
    sessionId: result.sessionId,
    debugUrl: result.debugUrl,
  });

  if (!result.submitted) {
    await emit(jobId, "submit_tiss_failed", "Lote TISS nao foi enviado para o portal.", {
      agentStep: "submit_tiss",
      toolName: "fillOrizonCredentials",
      nodeId: "submit_tiss",
      status: "failed",
      redacted: true,
    });

    await emit(jobId, "agent_tool_completed", "Envio TISS nao concluiu.", {
      agentStep: "submit_tiss",
      toolName: "fillOrizonCredentials",
      nodeId: "error",
      status: "failed",
      redacted: true,
    });

    return {
      ok: false,
      status: "submit_failed",
      message: "Login concluido, mas envio TISS nao confirmou.",
      usernameMasked: maskUsername(credential.username),
      mode: result.mode,
    };
  }

  await emit(jobId, "submit_tiss_completed", "Lote TISS enviado para a Orizon.", {
    agentStep: "submit_tiss",
    toolName: "fillOrizonCredentials",
    nodeId: "submit_tiss",
    status: "success",
    redacted: true,
    finalUrl: result.finalUrl,
  });

  await emit(jobId, "agent_tool_completed", "Login e envio TISS concluidos.", {
    agentStep: "submit_tiss",
    toolName: "fillOrizonCredentials",
    nodeId: "submit_tiss",
    status: "success",
    redacted: true,
    usernameMasked: maskUsername(credential.username),
  });

  return {
    ok: true,
    status: "login_succeeded",
    submitted: true,
    message: "Lote TISS enviado para a Orizon.",
    usernameMasked: maskUsername(credential.username),
    mode: result.mode,
  };
}

const submitProgressMessages: Record<string, string> = {
  popup_dismissed: "Popups iniciais fechados.",
  upload_page_opened: "Pagina de envio TISS aberta.",
  file_uploaded: "Arquivo TISS carregado no portal.",
  batches_selected: "Lotes selecionados para envio.",
  submitted: "Botao Enviar acionado.",
  confirmed: "Envio confirmado no modal.",
};

async function emitSubmitProgress(
  jobId: string,
  event: { stage: keyof typeof submitProgressMessages },
) {
  const message = submitProgressMessages[event.stage] ?? "Etapa de envio TISS.";
  await emit(jobId, "submit_tiss_progress", message, {
    agentStep: "submit_tiss",
    toolName: "fillOrizonCredentials",
    nodeId: "submit_tiss",
    status: "running",
    stage: event.stage,
    redacted: true,
  });
}

async function recordBrowserbaseSessionPrepared(jobId: string) {
  "use step";

  await emit(jobId, "browser_session_started", "Agente preparou runtime Browserbase.", {
    agentStep: "prepare_browser_session",
    toolName: "browserbase_stagehand_session_start",
    nodeId: "browserbase_session",
    status: "running",
    redacted: true,
    runtime: resolveBrowserRuntime(),
  });

  return {
    ok: true,
    runtime: resolveBrowserRuntime(),
    redacted: true,
  };
}

async function finalizeJobTool(
  jobId: string,
  status: "login_succeeded" | "failed",
  summary: string,
) {
  "use step";

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const finalStatus = job?.status === "login_succeeded" ? "login_succeeded" : status;

  if (finalStatus === "failed" && job?.status !== "failed") {
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: summary,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  await emit(jobId, "agent_completed", summary, {
    agentStep: "finalize",
    toolName: "finalizeJob",
    nodeId: finalStatus === "login_succeeded" ? "complete" : "error",
    status: finalStatus === "login_succeeded" ? "success" : "failed",
    redacted: true,
  });

  return { ok: finalStatus === "login_succeeded", status: finalStatus };
}

async function finalizeAgentRun(jobId: string, text: string) {
  "use step";

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

  if (job?.status === "login_succeeded") {
    await emit(jobId, "agent_completed", "Agente finalizou o job com login concluido.", {
      agentStep: "finalize",
      nodeId: "complete",
      status: "success",
      redacted: true,
    });
    return;
  }

  if (job?.status !== "failed") {
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: text || "Agente terminou sem concluir o login.",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  await emit(jobId, "agent_completed", text || "Agente finalizou sem sucesso.", {
    agentStep: "finalize",
    nodeId: "error",
    status: "failed",
    redacted: true,
  });
}

async function recordAgentStep(jobId: string, step: StepResult<ToolSet>) {
  "use step";

  const toolCalls = step.toolCalls ?? [];

  for (const toolCall of toolCalls) {
    await emit(jobId, "agent_step_started", `Agente executou step ${step.stepNumber + 1}.`, {
      agentStep: "agent_reasoning",
      toolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      nodeId: nodeForTool(toolCall.toolName),
      status: "running",
      redacted: true,
    });
  }
}

async function getJobUserId(jobId: string) {
  "use step";

  const [job] = await db.select({ userId: jobs.userId }).from(jobs).where(eq(jobs.id, jobId)).limit(1);

  if (!job) {
    throw new Error("Job nao encontrado.");
  }

  return job.userId;
}

function createSafeExaSearchTool() {
  const exaTool = webSearch({
    apiKey: process.env.EXA_API_KEY,
    numResults: 5,
    contents: { text: { maxCharacters: 800 } },
  });

  return {
    ...exaTool,
    description:
      "Busca publica na web (Exa) para grounding em regras da ANS, padrao TISS, codigos TUSS, operadoras de planos de saude e contexto do portal Orizon. Bloqueia consultas com XML, credenciais, CPF, nomes de beneficiarios ou identificadores de guia.",
    execute: async (input: { query: string }, context: unknown) => {
      const query = input.query ?? "";
      if (looksSensitiveSearchQuery(query)) {
        return {
          blocked: true,
          reason: "Consulta bloqueada por conter possivel dado sensivel.",
        };
      }

      return (exaTool.execute as (input: { query: string }, context: unknown) => Promise<unknown>)(
        { query },
        context,
      );
    },
  };
}

function looksSensitiveSearchQuery(query: string) {
  const normalized = query.toLowerCase();
  return (
    normalized.includes("<") ||
    normalized.includes("senha") ||
    normalized.includes("password") ||
    normalized.includes("cpf") ||
    normalized.includes("beneficiario") ||
    normalized.includes("beneficiário") ||
    normalized.includes("numero guia") ||
    normalized.includes("número guia")
  );
}

function nodeForTool(toolName: string) {
  if (toolName === "ingestTiss") return "tiss_extraction";
  if (toolName === "requestHumanValidation") return "human_validation";
  if (toolName === "fillOrizonCredentials") return "orizon_login";
  if (toolName === "finalizeJob") return "complete";
  if (toolName.startsWith("browserbase_")) return "browserbase_session";
  return "agent_review";
}

function resolveBrowserRuntime() {
  return "browserbase";
}

function maskUsername(username: string) {
  const [name, domain] = username.split("@");
  const visible = name.slice(0, 2);
  const maskedName = `${visible}${"*".repeat(Math.max(name.length - visible.length, 3))}`;
  return domain ? `${maskedName}@${domain}` : maskedName;
}

async function emit(
  jobId: string,
  type: string,
  message: string,
  payload: Record<string, unknown> = {},
) {
  const event = await appendJobEvent({ jobId, type, message, payload });
  const writer = getWritable<BillingWorkflowEvent>().getWriter();

  try {
    await writer.write({
      type,
      message,
      jobId,
      payload: {
        ...payload,
        eventId: event.id,
      },
    });
  } finally {
    writer.releaseLock();
  }
}
