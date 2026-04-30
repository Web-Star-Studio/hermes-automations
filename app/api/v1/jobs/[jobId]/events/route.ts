import { and, eq } from "drizzle-orm";
import { getRun } from "workflow/api";
import { requireApiKeySession } from "@/lib/api-session";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const { jobId } = await params;
  const [job] = await db
    .select({ runId: jobs.runId })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, session.userId)))
    .limit(1);

  if (!job) {
    return Response.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Job nao encontrado." } },
      { status: 404 },
    );
  }

  if (!job.runId) {
    return Response.json(
      {
        ok: false,
        error: { code: "RUN_NOT_READY", message: "Workflow ainda nao iniciou; tente novamente em instantes." },
      },
      { status: 409 },
    );
  }

  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get("startIndex");
  const startIndex = startIndexParam ? Number.parseInt(startIndexParam, 10) : undefined;

  try {
    const run = getRun(job.runId);
    const readable = run.getReadable({ startIndex });
    const encoder = new TextEncoder();

    const stream = readable.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const data = typeof chunk === "string" ? chunk : JSON.stringify(chunk);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
      }),
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "RUN_NOT_FOUND", message: "Workflow run nao encontrado." } },
      { status: 404 },
    );
  }
}
