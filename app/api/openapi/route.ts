import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 60;

const SPEC_PATH = path.join(process.cwd(), "docs", "openapi.yaml");

let cached: string | null = null;

async function loadSpec(): Promise<string> {
  if (cached) return cached;
  cached = await readFile(SPEC_PATH, "utf8");
  return cached;
}

export async function GET() {
  try {
    const body = await loadSpec();
    return new Response(body, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Content-Disposition": 'inline; filename="openapi.yaml"',
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao ler openapi.yaml.";
    return Response.json(
      { ok: false, error: { code: "SPEC_UNAVAILABLE", message } },
      { status: 500 },
    );
  }
}
