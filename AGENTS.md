<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Use `cursor-pointer` on enabled buttons and `cursor-not-allowed` when disabled so hover affordance is clear.
- When a logo should read as dark on a light background, prefer CSS filters on the image (for example `brightness-0` with dark-mode `invert`) instead of a semi-transparent overlay wash.

## Learned Workspace Facts

- Local Postgres is provided by root `docker-compose.yml`; keep `DATABASE_URL` aligned with `.env.example` and the Compose service (database `tiss_agent`, dev credentials from the compose file).
- If the Postgres container is healthy but nothing listens on host `5432`, it may have been created before port publishing was added; run `docker compose up -d --force-recreate postgres` so the port maps to the host.
- The app uses Drizzle ORM with PostgreSQL; `BLOB_READ_WRITE_TOKEN`, `FLAGS_SECRET`, and `FLAGS` can stay empty locally unless testing Vercel Blob or Flags.
