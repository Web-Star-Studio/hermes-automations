import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { stepCountIs, type ModelMessage, type StepResult, type ToolSet } from "ai";
import { webSearch } from "@exalabs/ai-sdk";
import { DurableAgent } from "@workflow/ai/agent";
import { defineHook, getWritable } from "workflow";
import { z } from "zod";
import { buildOrizonBillingAgentInstructions } from "@/lib/agents/orizon-billing-agent-config";
import {
  closePortalSession,
  loginToOrizonFature,
  openPortalSession,
  runPortalActions,
  type OrizonGuideToFill,
  type PortalAction,
} from "@/lib/browser-adapters/orizon-fature";
import {
  mapTissGuideToPortalSteps,
  tissGuideNameToTipo,
} from "@/lib/orizon/digitar-guia-fields";
import type { TissExpanded, TissGuideSummary } from "@/lib/tiss/parser";
import { db } from "@/lib/db";
import {
  jobFiles,
  jobs,
  platformCredentials,
  portalSessions,
  tissDocuments,
} from "@/lib/db/schema";
import { getGatewayModelId, getGatewayProviderOptions } from "@/lib/ai/gateway";
import { appendJobEvent } from "@/lib/jobs/events";
import { decryptSecret } from "@/lib/security/credentials";
import { getUserPreferences } from "@/lib/db/user-preferences";
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
      openPortalSession: {
        description:
          "Abre uma sessao Browserbase com keepAlive=true e faz login no Orizon Fature. Retorna sessionId para uso em runPortalActions. Use quando precisar de controle granular do portal em vez do fillOrizonCredentials monolitico.",
        inputSchema: z.object({
          platformCredentialId: z.string().min(1),
        }),
        execute: async (input) => openPortalSessionTool(jobId, input.platformCredentialId),
      },
      runPortalActions: {
        description:
          "Reconecta a uma sessao Orizon previamente aberta e executa uma lista de acoes (click / fill / select / navigate / snapshot / wait / dismissModal). Cada acao referencia pageId+elementId do mapa do portal. Reutilize a sessao em multiplas chamadas, mas batche varias acoes por chamada.",
        inputSchema: z.object({
          sessionId: z.string().min(1),
          actions: z.array(
            z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("click"), pageId: z.string(), elementId: z.string() }),
              z.object({ kind: z.literal("fill"), pageId: z.string(), elementId: z.string(), value: z.string() }),
              z.object({ kind: z.literal("select"), pageId: z.string(), elementId: z.string(), value: z.string() }),
              z.object({ kind: z.literal("navigate"), url: z.string() }),
              z.object({ kind: z.literal("snapshot") }),
              z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(30_000) }),
              z.object({ kind: z.literal("dismissModal"), modalId: z.string() }),
            ]),
          ),
        }),
        execute: async (input) => runPortalActionsTool(jobId, input.sessionId, input.actions),
      },
      closePortalSession: {
        description:
          "Encerra a sessao Browserbase aberta com openPortalSession. Sempre chame ao terminar para liberar recursos.",
        inputSchema: z.object({
          sessionId: z.string().min(1),
        }),
        execute: async (input) => closePortalSessionTool(jobId, input.sessionId),
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

  const files = await db.select().from(jobFiles).where(eq(jobFiles.jobId, jobId));

  if (files.length === 0) {
    throw new Error("Nenhum arquivo associado ao job.");
  }

  await emit(jobId, "agent_tool_called", `Agente iniciou extracao TISS de ${files.length} arquivo(s).`, {
    agentStep: "ingest_tiss",
    toolName: "ingestTiss",
    nodeId: "tiss_extraction",
    status: "running",
    redacted: true,
    fileCount: files.length,
  });

  const perFile: Array<{ fileName: string; summary: TissSummary }> = [];
  for (const file of files) {
    const bytes = await readUploadBytes(file.blobUrl);
    const documents = extractXmlDocuments(file.fileName, bytes);
    // Each ZIP can contain multiple XMLs; merge them as if they were one TISS payload.
    for (const doc of documents) {
      const summary = parseTissXml(doc.xml);
      perFile.push({ fileName: file.fileName, summary });
    }
  }

  const aggregate = aggregateTissSummaries(perFile);

  await db
    .insert(tissDocuments)
    .values({
      id: randomUUID(),
      jobId,
      standardVersion: aggregate.standardVersion,
      transactionType: aggregate.transactionType,
      providerName: aggregate.providerName,
      providerRegister: aggregate.providerRegister,
      operatorRegister: aggregate.operatorRegister,
      batchNumber: aggregate.batchNumber,
      guideCount: aggregate.guideCount,
      totalAmount: aggregate.totalAmount,
      beneficiaryNames: aggregate.beneficiaryNames,
      rawSummary: aggregate.rawSummary,
    })
    .onConflictDoUpdate({
      target: tissDocuments.jobId,
      set: {
        standardVersion: aggregate.standardVersion,
        transactionType: aggregate.transactionType,
        providerName: aggregate.providerName,
        providerRegister: aggregate.providerRegister,
        operatorRegister: aggregate.operatorRegister,
        batchNumber: aggregate.batchNumber,
        guideCount: aggregate.guideCount,
        totalAmount: aggregate.totalAmount,
        beneficiaryNames: aggregate.beneficiaryNames,
        rawSummary: aggregate.rawSummary,
        updatedAt: new Date(),
      },
    });

  await emit(
    jobId,
    "agent_tool_completed",
    `Extracao TISS concluida (${files.length} arquivo(s), ${aggregate.guideCount} guia(s)).`,
    {
      agentStep: "ingest_tiss",
      toolName: "ingestTiss",
      nodeId: "tiss_extraction",
      status: "success",
      redacted: true,
      fileCount: files.length,
      standardVersion: aggregate.standardVersion,
      guideCount: aggregate.guideCount,
    },
  );

  return {
    ...aggregate,
    rawSummary: {
      standardVersion: aggregate.standardVersion,
      transactionType: aggregate.transactionType,
      providerName: aggregate.providerName,
      batchNumber: aggregate.batchNumber,
      guideCount: aggregate.guideCount,
      totalAmount: aggregate.totalAmount,
      fileCount: files.length,
    },
  };
}

/**
 * Combines parsed summaries from N files into a single TissSummary suitable
 * for the aggregate `tissDocuments` row. Sums totals, concatenates guides
 * and beneficiaries (deduped), and records per-file breakdown in
 * rawSummary.expanded.files for the UI.
 */
function aggregateTissSummaries(
  perFile: Array<{ fileName: string; summary: TissSummary }>,
): TissSummary {
  if (perFile.length === 0) {
    throw new Error("aggregateTissSummaries: nada para agregar.");
  }
  if (perFile.length === 1) {
    const only = perFile[0];
    const expanded = only.summary.rawSummary.expanded;
    return {
      ...only.summary,
      rawSummary: {
        ...only.summary.rawSummary,
        expanded: expanded
          ? {
              ...expanded,
              files: [
                {
                  fileName: only.fileName,
                  guideCount: only.summary.guideCount,
                  totalAmount: only.summary.totalAmount,
                  batchNumber: only.summary.batchNumber,
                },
              ],
            }
          : expanded,
      },
    };
  }

  const first = perFile[0].summary;
  const guides = perFile.flatMap((p) => p.summary.rawSummary.expanded?.guides ?? []);
  const procedureCount = perFile.reduce(
    (acc, p) => acc + (p.summary.rawSummary.expanded?.procedureCount ?? 0),
    0,
  );
  const totalAmountSum = perFile.reduce((acc, p) => {
    const n = Number(p.summary.totalAmount ?? 0);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  const guideCountSum = perFile.reduce((acc, p) => {
    const n = Number(p.summary.guideCount ?? 0);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  const beneficiaryNames = Array.from(
    new Set(perFile.flatMap((p) => p.summary.beneficiaryNames)),
  ).slice(0, 50);
  const guideTypesAll = Array.from(
    new Set(perFile.flatMap((p) => p.summary.rawSummary.expanded?.guideTypes ?? [])),
  );

  return {
    standardVersion: first.standardVersion,
    transactionType: first.transactionType,
    providerName: first.providerName,
    providerRegister: first.providerRegister,
    operatorRegister: first.operatorRegister,
    batchNumber: perFile.map((p) => p.summary.batchNumber).filter(Boolean).join(", ") || null,
    guideCount: String(guideCountSum),
    totalAmount: totalAmountSum > 0 ? totalAmountSum.toFixed(2) : null,
    beneficiaryNames,
    rawSummary: {
      ...first.rawSummary,
      expanded: {
        competencia: first.rawSummary.expanded?.competencia ?? null,
        dataEnvioLote: first.rawSummary.expanded?.dataEnvioLote ?? null,
        dataInicialFaturamento: first.rawSummary.expanded?.dataInicialFaturamento ?? null,
        dataFinalFaturamento: first.rawSummary.expanded?.dataFinalFaturamento ?? null,
        tipoFaturamento: first.rawSummary.expanded?.tipoFaturamento ?? null,
        guideTypes: guideTypesAll,
        procedureCount,
        procedureCodes: first.rawSummary.expanded?.procedureCodes ?? [],
        amounts: first.rawSummary.expanded?.amounts ?? {
          procedimentos: null,
          taxasAlugueis: null,
          materiais: null,
          medicamentos: null,
          diarias: null,
          gases: null,
          total: totalAmountSum > 0 ? totalAmountSum.toFixed(2) : null,
        },
        guides,
        files: perFile.map((p) => ({
          fileName: p.fileName,
          guideCount: p.summary.guideCount,
          totalAmount: p.summary.totalAmount,
          batchNumber: p.summary.batchNumber,
        })),
      },
    },
  };
}

async function recordAgentStarted(jobId: string) {
  "use step";

  const [job] = await db
    .select({ flowType: jobs.flowType })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  const flowType = job?.flowType ?? "short";
  const flowLabel = flowType === "complete" ? "Fluxo completo" : "Fluxo curto";

  await emit(jobId, "agent_started", `Agente Hermes iniciado (${flowLabel}).`, {
    agentStep: "start",
    nodeId: "agent_review",
    status: "running",
    flowType,
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

  const files = await db.select().from(jobFiles).where(eq(jobFiles.jobId, jobId));

  if (files.length === 0) {
    throw new Error("Nenhum arquivo associado ao job.");
  }

  for (const f of files) {
    if (!f.fileName.toLowerCase().endsWith(".zip")) {
      throw new Error(
        `O portal Orizon Fature so aceita arquivos .zip; reenvie '${f.fileName}' compactado.`,
      );
    }
  }

  const tissFiles = await Promise.all(
    files.map(async (f) => ({
      fileName: f.fileName,
      bytes: Buffer.from(await readUploadBytes(f.blobUrl)),
      contentType: f.contentType,
    })),
  );

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

  const userPrefs = await getUserPreferences(job.userId);

  const guidesToFill =
    job.flowType === "complete" ? await buildGuidesToFill(jobId) : undefined;

  let result;
  try {
    result = await loginToOrizonFature({
      username: credential.username,
      password,
      jobId,
      flowType: job.flowType,
      visionEnabled: userPrefs.browserVisionEnabled,
      tissFiles,
      guidesToFill,
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
  submission_succeeded: "Lotes enviados com sucesso (modal de sucesso confirmado).",
  digitar_guia_opened: "Pagina 'Digitar Guia' aberta no portal.",
  guide_started: "Iniciando preenchimento de guia no portal.",
  guide_step_filled: "Etapa da guia preenchida.",
  guide_saved: "Guia salva no portal.",
  guide_failed: "Falha ao salvar guia no portal.",
  vision_recovery: "Visão (LLM) usada para localizar elemento na pagina.",
};

async function emitSubmitProgress(
  jobId: string,
  event: import("@/lib/browser-adapters/orizon-fature").OrizonProgressEvent,
) {
  const message = submitProgressMessages[event.stage] ?? "Etapa de envio TISS.";
  const payload: Record<string, unknown> = {
    agentStep: "submit_tiss",
    toolName: "fillOrizonCredentials",
    nodeId: "submit_tiss",
    status: event.stage === "guide_failed" ? "failed" : "running",
    stage: event.stage,
    redacted: true,
  };
  if (event.stage === "vision_recovery") {
    payload.intent = event.intent;
    if (event.selector) payload.selector = event.selector;
  }
  if ("guideIndex" in event) {
    payload.guideIndex = event.guideIndex;
  }
  if (event.stage === "guide_started") {
    payload.tipoId = event.tipoId;
    if (event.label) payload.label = event.label;
  }
  if (event.stage === "guide_step_filled") {
    payload.step = event.step;
  }
  if (event.stage === "guide_failed") {
    payload.reason = event.reason;
  }
  await emit(jobId, "submit_tiss_progress", message, payload);
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

async function buildGuidesToFill(jobId: string): Promise<OrizonGuideToFill[]> {
  "use step";

  const [tiss] = await db
    .select({ operatorRegister: tissDocuments.operatorRegister, rawSummary: tissDocuments.rawSummary })
    .from(tissDocuments)
    .where(eq(tissDocuments.jobId, jobId))
    .limit(1);

  if (!tiss) return [];

  const expanded = (tiss.rawSummary as { expanded?: TissExpanded } | null)?.expanded;
  const guides = expanded?.guides ?? [];
  const lotOperadoraAns = tiss.operatorRegister ?? "";

  return guides.map((guide: TissGuideSummary, index: number): OrizonGuideToFill => {
    const tipoId = tissGuideNameToTipo(guide.type);
    return {
      index,
      tipoId,
      // Prefer per-guide registroANS when present (handles mixed-operadora batches);
      // fall back to the lote-level value.
      operadoraAns: guide.registroANS ?? lotOperadoraAns,
      steps: mapTissGuideToPortalSteps(guide, tipoId),
      procedures: guide.procedures.map((p) => ({
        codigo: p.codigo,
        descricao: p.descricao,
        quantidade: p.quantidade,
        valorUnitario: p.valorUnitario,
        valorTotal: p.valorTotal,
        dataExecucao: p.dataExecucao,
        codigoTabela: p.codigoTabela,
      })),
      tissData: {
        type: guide.type,
        numeroGuiaPrestador: guide.numeroGuiaPrestador,
        numeroGuiaOperadora: guide.numeroGuiaOperadora,
        numeroGuiaPrincipal: guide.numeroGuiaPrincipal,
        registroANS: guide.registroANS ?? lotOperadoraAns,
        beneficiario: guide.beneficiario,
        numeroCarteira: guide.numeroCarteira,
        dataAtendimento: guide.dataAtendimento,
        dataAutorizacao: guide.dataAutorizacao,
        senhaAutorizacao: guide.senhaAutorizacao,
        validadeSenha: guide.validadeSenha,
        valorTotal: guide.valorTotal,
      },
      label: guide.numeroGuiaPrestador ?? guide.beneficiario ?? `guia-${index + 1}`,
    };
  });
}

function maskUsername(username: string) {
  const [name, domain] = username.split("@");
  const visible = name.slice(0, 2);
  const maskedName = `${visible}${"*".repeat(Math.max(name.length - visible.length, 3))}`;
  return domain ? `${maskedName}@${domain}` : maskedName;
}

async function openPortalSessionTool(jobId: string, platformCredentialId: string) {
  "use step";

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error("Job nao encontrado.");

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
  if (!credential) throw new Error("Credencial nao encontrada.");

  const password = decryptSecret({
    encryptedValue: credential.encryptedPassword,
    iv: credential.iv,
    authTag: credential.authTag,
  });

  const userPrefs = await getUserPreferences(job.userId);

  const result = await openPortalSession({
    username: credential.username,
    password,
    jobId,
    visionEnabled: userPrefs.browserVisionEnabled,
  });

  if (!result.ok || !result.browserbaseSessionId || !result.connectUrl) {
    return { ok: false, message: result.message };
  }

  const sessionRowId = randomUUID();
  await db.insert(portalSessions).values({
    id: sessionRowId,
    jobId,
    userId: job.userId,
    browserbaseSessionId: result.browserbaseSessionId,
    connectUrl: result.connectUrl,
    status: "active",
  });

  await emit(jobId, "portal_session_opened", "Sessao Orizon Fature aberta.", {
    nodeId: "browserbase_session",
    status: "running",
    sessionId: sessionRowId,
    redacted: true,
  });

  return {
    ok: true,
    sessionId: sessionRowId,
    finalUrl: result.finalUrl,
    message: result.message,
    usernameMasked: maskUsername(credential.username),
  };
}

async function runPortalActionsTool(
  jobId: string,
  sessionId: string,
  actions: PortalAction[],
) {
  "use step";

  const [row] = await db
    .select()
    .from(portalSessions)
    .where(and(eq(portalSessions.id, sessionId), eq(portalSessions.jobId, jobId)))
    .limit(1);
  if (!row) throw new Error("Sessao do portal nao encontrada.");
  if (row.status !== "active") throw new Error(`Sessao do portal nao esta ativa: ${row.status}.`);

  const userPrefs = await getUserPreferences(row.userId);

  const result = await runPortalActions({
    connectUrl: row.connectUrl,
    actions,
    visionEnabled: userPrefs.browserVisionEnabled,
  });

  await db
    .update(portalSessions)
    .set({ updatedAt: new Date() })
    .where(eq(portalSessions.id, sessionId));

  await emit(jobId, "portal_actions_executed", `Executadas ${actions.length} acao(oes) no portal.`, {
    nodeId: "submit_tiss",
    status: "running",
    sessionId,
    actionCount: actions.length,
    okCount: result.results.filter((r) => r.ok).length,
    redacted: true,
  });

  return {
    ok: result.ok,
    finalUrl: result.finalUrl,
    results: result.results,
  };
}

async function closePortalSessionTool(jobId: string, sessionId: string) {
  "use step";

  const [row] = await db
    .select()
    .from(portalSessions)
    .where(and(eq(portalSessions.id, sessionId), eq(portalSessions.jobId, jobId)))
    .limit(1);
  if (!row) return { ok: false, message: "Sessao nao encontrada." };

  await closePortalSession({ sessionId: row.browserbaseSessionId });
  await db
    .update(portalSessions)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(portalSessions.id, sessionId));

  await emit(jobId, "portal_session_closed", "Sessao Orizon Fature encerrada.", {
    nodeId: "browserbase_session",
    status: "success",
    sessionId,
    redacted: true,
  });

  return { ok: true };
}

async function emit(
  jobId: string,
  type: string,
  message: string,
  payload: Record<string, unknown> = {},
) {
  // The DB row is the source of truth — it must always be written.
  const event = await appendJobEvent({ jobId, type, message, payload });

  // The writable stream is shared with the agent (`agent.stream({ writable: getWritable() })`)
  // and gets closed when the agent finishes (sendFinish: true by default). Any emit calls
  // that fire AFTER the agent's last step (e.g., from finalizeAgentRun) will hit a closed
  // stream and return HTTP 409. The live-update miss is non-fatal — the timeline reads
  // from the DB.
  try {
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
  } catch {
    // Stream closed (post-agent-finish) — DB row already written above.
  }
}
