import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { db } from "@/lib/db";
import { auditLogs, jobs, type JobStatus } from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";
import { requireApiSession } from "@/lib/session";

const stoppableStatuses: ReadonlySet<JobStatus> = new Set([
  "uploaded",
  "awaiting_validation",
  "approved",
  "running",
]);

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { jobId } = await params;
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, session.user.id)))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Job nao encontrado." } },
      { status: 404 },
    );
  }

  if (!stoppableStatuses.has(job.status)) {
    return NextResponse.json(
      { ok: false, error: { code: "JOB_NOT_STOPPABLE", message: "Job ja finalizado." } },
      { status: 409 },
    );
  }

  if (job.runId) {
    await getRun(job.runId)
      .cancel()
      .catch(() => {
        // Run may already be terminal; we still mark the DB as canceled.
      });
  }

  const message = "Cancelado pelo usuario.";

  await Promise.all([
    db
      .update(jobs)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(jobs.id, jobId)),
    appendJobEvent({
      jobId,
      type: "failed",
      message,
      payload: { nodeId: "error", status: "failed", reason: "user_canceled", redacted: true },
    }),
    db.insert(auditLogs).values({
      id: randomUUID(),
      userId: session.user.id,
      action: "job.canceled",
      entityType: "job",
      entityId: jobId,
      metadata: { previousStatus: job.status },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
