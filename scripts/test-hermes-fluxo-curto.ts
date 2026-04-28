/**
 * End-to-end Hermes test for the Fluxo curto. Spins up the agent the same
 * way `tissBillingWorkflow` does, but with stubbed durability/DB so it runs
 * outside the workflow runtime. We watch which tools Hermes picks and in
 * which order, and let `fillOrizonCredentials` call the real adapter
 * against the live Orizon Fature portal.
 *
 *   pnpm tsx scripts/test-hermes-fluxo-curto.ts
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { buildOrizonBillingAgentInstructions } from "@/lib/agents/orizon-billing-agent-config";
import { loginToOrizonFature } from "@/lib/browser-adapters/orizon-fature";
import { getGatewayModel } from "@/lib/ai/gateway";
import { extractXmlDocuments, parseTissXml } from "@/lib/tiss/parser";

const filePath =
  process.env.UPLOAD_FILE ?? "/Users/webstar/Downloads/1114_a39e86b0f7e5ee9eba31e7dc51bb9329.zip";
const portalUsername = process.env.ORIZON_USERNAME ?? "186870";
const portalPassword = process.env.ORIZON_PASSWORD ?? "Doc2026*";

async function main() {
  const fileBytes = readFileSync(filePath);
  const fileName = basename(filePath);
  const documents = extractXmlDocuments(fileName, fileBytes);
  const summary = parseTissXml(documents[0].xml);

  // Pre-approved validation payload — simulates what the human already chose.
  // The agent will see auto-approval through the requestHumanValidation tool.
  const approval = {
    platformId: "orizon_fature" as const,
    platformCredentialId: "test-credential",
    validatedData: {
      providerName: summary.providerName,
      batchNumber: summary.batchNumber,
      totalAmount: summary.totalAmount,
    },
  };

  const calls: Array<{ toolName: string; args: unknown; result: unknown }> = [];
  const startedAt = Date.now();
  const log = (msg: string) =>
    console.log(`[+${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${msg}`);

  const result = await generateText({
    model: getGatewayModel(),
    system: buildOrizonBillingAgentInstructions(),
    prompt:
      "Execute o fluxo do job: ingerir TISS, resumir para validacao humana, pausar ate aprovacao, " +
      "preparar Browserbase, fazer login no Orizon Fature com a ferramenta segura e finalizar.",
    stopWhen: stepCountIs(8),
    tools: {
      ingestTiss: tool({
        description:
          "Extrai deterministicamente o arquivo XML/ZIP TISS enviado e grava um resumo estruturado para validacao.",
        inputSchema: z.object({}),
        execute: async () => {
          log("ingestTiss → returning parsed summary");
          calls.push({ toolName: "ingestTiss", args: {}, result: summary });
          return summary;
        },
      }),
      requestHumanValidation: tool({
        description:
          "Pausa o workflow ate um humano validar os dados TISS e escolher a credencial Orizon. (TEST: auto-aprova)",
        inputSchema: z.object({ summary: z.string() }),
        execute: async (input) => {
          log(`requestHumanValidation → auto-approved (summary: "${input.summary.slice(0, 80)}…")`);
          calls.push({ toolName: "requestHumanValidation", args: input, result: approval });
          return { approved: true, ...approval };
        },
      }),
      fillOrizonCredentials: tool({
        description:
          "Ferramenta segura que descriptografa credenciais fora do contexto do modelo e executa o login + envio do lote no Orizon Fature.",
        inputSchema: z.object({
          platformCredentialId: z.string(),
          validatedData: z.record(z.string(), z.unknown()).default({}),
        }),
        execute: async (input) => {
          log(`fillOrizonCredentials → driving the portal (cred=${input.platformCredentialId})`);
          const adapter = await loginToOrizonFature({
            username: portalUsername,
            password: portalPassword,
            jobId: `hermes-test-${Date.now()}`,
            flowType: "short",
            visionEnabled: false,
            tissFiles: [
              {
                fileName,
                bytes: fileBytes,
                contentType: "application/zip",
              },
            ],
            onProgress: async (event) => log(`  · ${event.stage}`),
          });
          calls.push({ toolName: "fillOrizonCredentials", args: input, result: adapter });
          return {
            ok: adapter.ok,
            status: adapter.submitted ? "login_succeeded" : "failed",
            message: adapter.message,
            usernameMasked: portalUsername.slice(0, 3) + "***",
          };
        },
      }),
      finalizeJob: tool({
        description:
          "Registra a conclusao estruturada do agente depois do login ou de uma falha recuperavel.",
        inputSchema: z.object({
          status: z.enum(["login_succeeded", "failed"]),
          summary: z.string().min(1),
        }),
        execute: async (input) => {
          log(`finalizeJob → ${input.status}: ${input.summary}`);
          calls.push({ toolName: "finalizeJob", args: input, result: { ok: true } });
          return { ok: input.status === "login_succeeded", status: input.status };
        },
      }),
    },
  });

  console.log("\n[done]");
  console.log(`Tool sequence: ${calls.map((c) => c.toolName).join(" → ")}`);
  console.log(`Final text: ${result.text || "(no text)"}`);
  console.log(`Total steps: ${result.steps.length}`);
  console.log(`Finish reason: ${result.finishReason}`);
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
