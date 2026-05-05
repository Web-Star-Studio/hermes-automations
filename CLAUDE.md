# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `pnpm dev` — Next.js dev server (Turbopack, root pinned to `process.cwd()` in `next.config.ts`).
- `pnpm build` / `pnpm start` — Production build / serve. `next.config.ts` is wrapped with `withWorkflow` from the Workflow DevKit.
- `pnpm lint` — ESLint via `eslint.config.mjs` (extends `eslint-config-next`; `components/ai-elements/**`, `components/ui/carousel.tsx`, and `hooks/use-mobile.ts` are intentionally ignored — do not lint-fix them).
- `pnpm typecheck` — `tsc --noEmit`. Path alias `@/*` resolves to repo root.
- `pnpm test` — Vitest (Node env, `@/*` aliased to repo root). Run a single test with `pnpm vitest run tests/unit/<file>.test.ts` or filter by name with `-t "<pattern>"`.
- `pnpm db:push` — Apply Drizzle schema directly (preferred for local dev). `pnpm db:generate` then `pnpm db:migrate` produces / applies migration files in `drizzle/`.
- `docker compose up -d postgres` — Start local Postgres 17 (`tiss_agent` DB, `user`/`password`).
- `pnpm tsx scripts/test-fluxo-curto.ts` / `scripts/test-hermes-fluxo-curto.ts` — End-to-end smoke against the live Orizon Fature portal. Requires `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and a real `.zip`. Real credentials live in env vars (`ORIZON_USERNAME`, `ORIZON_PASSWORD`); never hardcode.

## Architecture

This is a Next.js 16 (App Router, React 19) app that automates Brazilian TISS medical-billing submission to the Orizon Fature portal. The agent is a `DurableAgent` from `@workflow/ai` orchestrated by the Workflow DevKit; it runs deterministic tools and pauses for human validation.

### Job lifecycle (`workflows/tiss-billing-workflow.ts`)

`tissBillingWorkflow(jobId)` is a `"use workflow"` function that creates a `DurableAgent` and streams it. The agent has a closed tool set — every tool runs as a workflow step (`"use step"`) so retries and durability work:

1. `ingestTiss` — reads `jobFiles` blobs, runs `lib/tiss/parser.ts` (XML/ZIP, `fast-xml-parser`), aggregates multi-file batches into a single `tissDocuments` row.
2. `requestHumanValidation` — pauses on a typed hook (`billingValidationHook`, `defineHook` from `workflow`). The validation API resumes the hook with `{ platformId, platformCredentialId, validatedData }`. **Auto-approval path:** if the job was created via `/api/v1/jobs` with a pre-supplied `platformCredentialId`, the workflow skips the pause entirely (`tryAutoApproveValidation`).
3. `fillOrizonCredentials` — pre-flight loads job/credential/files, decrypts the password (any failure throws `FatalError` to skip the workflow's default 3 retries), then calls `loginToOrizonFature` in `lib/browser-adapters/orizon-fature/`. For `flowType === "complete"`, it also builds `guidesToFill` from the parsed TISS and submits each guide.
4. Optional granular flow: `openPortalSession` → multiple `runPortalActions` → `closePortalSession` (used when the agent needs fine control instead of the monolithic `fillOrizonCredentials`). Sessions persist as `portalSessions` rows so the agent can reconnect across steps.
5. `finalizeJob` records terminal status. `finalizeAgentRun` runs after the agent stream closes to handle the case where it didn't call `finalizeJob`.

The agent also exposes Browserbase Stagehand tools (`browserbase_stagehand_*`) but they are intentionally **stubbed** — real authenticated browser work only happens inside `fillOrizonCredentials` / `runPortalActions` so credentials never enter the model context. `webSearch` (Exa) is wrapped to block queries containing XML, CPF, or beneficiary terms.

### Event timeline

Every step emits via `emit()` in the workflow file, which writes a `jobEvents` row (source of truth) **and** writes to the shared `getWritable()` stream. The DB row is always written — stream writes are best-effort and intentionally swallow errors when the stream has closed (post-agent-finish emits hit a closed writer; that's expected). The UI reads events through SSE at `/api/v1/jobs/[jobId]/events` and renders them in `components/jobs/job-detail.tsx`.

### Auth model — three layers

- **Better Auth** (`lib/auth.ts`, email+password, Drizzle adapter). New users land in `status: "pending"` and cannot access `/app/*` until an admin approves them — see `app/pending/`.
- **Admin gating** (`lib/auth/admin.ts`) — `ADMIN_EMAILS` env (comma-separated, lowercase compared) is the only mechanism. Wraps both pages (`requireAdminPageSession` → `notFound()` on miss) and APIs (`requireAdminApiSession`). Admin routes live under `/app/admin/*` and `/api/admin/*`.
- **API keys** (`lib/api-keys.ts`, `lib/api-session.ts`) — `hapi_<base32>` tokens, hashed with SHA-256 + `prefix` stored separately for display. `requireApiKeySession` reads `Authorization: Bearer ...`, looks up the key, and rejects if the owning user isn't `approved`. Used by all `/api/v1/*` routes.

### Credential security

`lib/security/credentials.ts` uses AES-256-GCM with `CREDENTIAL_ENCRYPTION_KEY` (accepts 64-char hex, base64-encoded 32 bytes, or a passphrase that gets SHA-256'd). Each `platformCredentials` row stores `{ encryptedPassword, iv, authTag }`. **Rotating `CREDENTIAL_ENCRYPTION_KEY` invalidates every saved credential** — the workflow surfaces a friendly re-cadastre message; do not silently fall back. Decryption is intentionally invoked only inside the secure tool, never inside model-visible code paths.

### Storage

Uploads go through `lib/storage/uploads.ts` to either Cloudflare R2 (S3 SDK, configured by `R2_*` env) or `.local-uploads/` in dev. `readUploadBytes` resolves either back to bytes. R2 buckets are private — files are never served publicly; all access is server-side.

### AI Gateway

`lib/ai/gateway.ts` centralizes model selection. Models use the `provider/model` Vercel AI Gateway format (default `openai/gpt-5.4`, fallback `anthropic/claude-sonnet-4.6`). For local dev with OIDC: `vercel link && vercel env pull .env.local`. Otherwise set `AI_GATEWAY_API_KEY`. `getGatewayProviderOptions` tags requests with `feature:`, `env:`, and `job:` for observability.

### Orizon portal mapping

The portal is modeled deterministically:
- `lib/orizon/portal-map.ts` — page/element IDs and selector candidates.
- `lib/orizon/digitar-guia-fields.ts` — maps TISS guide fields to portal form steps per guide type (`consulta`, `sadt`, `honorario`, `internacao`, `odonto`).
- `lib/orizon/runtime-introspection.ts` — DOM snapshots used as fallback context for the LLM vision tool (`lib/ai/vision.ts`) when a selector fails.
- `lib/browser-adapters/orizon-fature/index.ts` — the actual Playwright/Browserbase driver. Browserbase is the only supported runtime.

### REST API v1

`/api/v1/*` is the external automation surface, documented in `docs/openapi.yaml` (served by `app/api/openapi/`). Resources are scoped to the API key's owning user — the routes always filter by `userId`. Job creation accepts up to 50 files (≤25 MB each, `.zip`/`.xml` only). Internal `/api/jobs/*` routes use Better Auth sessions instead of API keys and are what the web UI calls.

## Data model quick reference

Schema lives in `lib/db/schema.ts`. Core tables: `user` (with `pending|approved|rejected` status), `session`/`account`/`verification` (Better Auth), `platforms`/`platformCredentials`, `jobs` (status enum: `uploaded|awaiting_validation|approved|running|login_succeeded|failed`), `jobFiles`, `tissDocuments` (one per job, holds aggregated parse summary), `jobEvents` (timeline), `portalSessions`, `apiKeys`, `userPreferences` (currently just `browserVisionEnabled`), and admin audit log tables.
