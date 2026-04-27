import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { runId } = await params;

  try {
    const run = getRun(runId);
    const [status, workflowName, createdAt, startedAt, completedAt] = await Promise.all([
      run.status,
      run.workflowName,
      run.createdAt,
      run.startedAt,
      run.completedAt,
    ]);

    return NextResponse.json({
      ok: true,
      runId,
      status,
      workflowName,
      createdAt: createdAt?.toISOString?.() ?? null,
      startedAt: startedAt?.toISOString?.() ?? null,
      completedAt: completedAt?.toISOString?.() ?? null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "RUN_NOT_FOUND", message: "Workflow run nao encontrado." } },
      { status: 404 },
    );
  }
}
