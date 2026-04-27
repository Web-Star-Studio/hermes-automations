import { getRun } from "workflow/api";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get("startIndex");
  const startIndex = startIndexParam ? Number.parseInt(startIndexParam, 10) : undefined;

  try {
    const run = getRun(runId);
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
