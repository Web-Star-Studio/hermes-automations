# TISS Agent Platform

MVP Next.js para automacao agentica de faturamento medico TISS com validacao humana, Workflow DevKit, AI SDK DurableAgent, Vercel AI Gateway, Browserbase, Exa, Better Auth, Drizzle/Postgres, shadcn/ui, SWR, Vercel Flags e Vercel Blob.

## Setup

1. Copie `.env.example` para `.env.local` e preencha `DATABASE_URL`, `BETTER_AUTH_SECRET` e `CREDENTIAL_ENCRYPTION_KEY`.
2. Rode `pnpm install`.
3. Inicie o Postgres local com `docker compose up -d postgres`.
4. Crie as tabelas com `pnpm db:push` ou gere migrations com `pnpm db:generate && pnpm db:migrate`.
5. Inicie com `pnpm dev`.

## Fluxo MVP

- `/sign-up` cria usuario com Better Auth.
- `/app/settings/platforms` cadastra credenciais Orizon criptografadas.
- `/app/jobs/new` recebe XML ou ZIP TISS.
- O workflow inicia o `OrizonBillingAgent`, que chama o parser TISS como tool deterministica, pausa para validacao humana e executa o login seguro.
- O agente usa Vercel AI Gateway como camada de modelo, Browserbase como runtime de browser e Exa apenas para pesquisa publica.
- Browserbase e o runtime obrigatorio de automacao de browser.

## AI Gateway

O projeto centraliza chamadas futuras em `lib/ai/gateway.ts`. Ele usa `ai@6`, entao modelos no formato `provider/model` roteiam pelo Vercel AI Gateway.

Para desenvolvimento local com OIDC:

```bash
vercel link
vercel env pull .env.local
```

Como alternativa, defina `AI_GATEWAY_API_KEY`. O modelo padrao fica em `AI_GATEWAY_MODEL` e o fallback em `AI_GATEWAY_FALLBACK_MODEL`.

## Browserbase e Exa

O caminho principal de automacao usa Browserbase:

```bash
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...
BROWSERBASE_ENABLE_STEALTH=true
EXA_API_KEY=...
```

## Verificacao

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

