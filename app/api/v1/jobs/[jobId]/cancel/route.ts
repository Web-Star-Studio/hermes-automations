import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { requireApiKeySession } from "@/lib/api-session";
import { db } from "@/lib/db";
import { auditLogs, jobs, type JobStatus } from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";

export const runtime = "nodejs";

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
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const { jobId } = await params;
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, session.userId)))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Job nao encontrado." } },
      { status: 404 },
    );
  }

  if (!stoppableStatuses.has(job.status)) {
    return NextResponse.json(
      { ok: true, alreadyTerminal: true, status: job.status },
      { status: 200 },
    );
  }

  if (job.runId) {
    await getRun(job.runId)
      .cancel()
      .catch(() => undefined);
  }

  const message = "Cancelado via API.";

  await Promise.all([
    db
      .update(jobs)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(jobs.id, jobId)),
    appendJobEvent({
      jobId,
      type: "failed",
      message,
      payload: { nodeId: "error", status: "failed", reason: "api_canceled", redacted: true },
    }),
    db.insert(auditLogs).values({
      id: randomUUID(),
      userId: session.userId,
      action: "api.job.canceled",
      entityType: "job",
      entityId: jobId,
      metadata: {
        apiKeyId: session.apiKeyId,
        previousStatus: job.status,
        userAgent: request.headers.get("user-agent"),
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
