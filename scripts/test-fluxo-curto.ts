/**
 * Smoke test for the Fluxo curto. Runs the browser adapter against the live
 * Orizon Fature portal with a real ZIP file. Logs every progress event +
 * the final result.
 *
 * Usage:
 *   pnpm tsx scripts/test-fluxo-curto.ts
 *
 * Required env: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, AI_GATEWAY_API_KEY
 * (only needed if visionEnabled=true), plus ORIZON_USERNAME / ORIZON_PASSWORD /
 * UPLOAD_FILE / VISION (optional). Defaults below match the test request.
 */

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { loginToOrizonFature } from "@/lib/browser-adapters/orizon-fature";

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const username = flagValue("user") ?? process.env.ORIZON_USERNAME ?? "186870";
const password = flagValue("pass") ?? process.env.ORIZON_PASSWORD ?? "Doc2026*";
const filePath =
  flagValue("file") ??
  process.env.UPLOAD_FILE ??
  "/Users/webstar/Downloads/1114_a39e86b0f7e5ee9eba31e7dc51bb9329.zip";
const visionEnabled = (flagValue("vision") ?? process.env.VISION ?? "false") === "true";

async function main() {
  const stat = statSync(filePath);
  console.log(`[setup] file=${basename(filePath)} size=${stat.size}B vision=${visionEnabled}`);
  console.log(`[setup] user=${username} BROWSERBASE_PROJECT_ID=${process.env.BROWSERBASE_PROJECT_ID?.slice(0, 8)}…`);

  const bytes = readFileSync(filePath);
  const startedAt = Date.now();

  const result = await loginToOrizonFature({
    username,
    password,
    jobId: `test-${Date.now()}`,
    flowType: "short",
    visionEnabled,
    tissFiles: [
      {
        fileName: basename(filePath),
        bytes,
        contentType: "application/zip",
      },
    ],
    onProgress: async (event) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[+${elapsed}s] ${event.stage}${formatEventDetail(event)}`);
    },
  });

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[done] (${durationSec}s)`);
  console.log(JSON.stringify(result, null, 2));
}

function formatEventDetail(event: Record<string, unknown>): string {
  const ignored = new Set(["stage"]);
  const extras = Object.entries(event)
    .filter(([k]) => !ignored.has(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return extras ? ` (${extras})` : "";
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
