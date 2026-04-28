import { randomUUID } from "node:crypto";
import { asc, eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { db } from "@/lib/db";
import { auditLogs, jobEvents, jobFiles, jobs, tissDocuments, type JobStatus } from "@/lib/db/schema";
import { buildJobWorkflowState } from "@/lib/jobs/workflow-visualization";
import { requireApiSession } from "@/lib/session";

const liveStatuses: ReadonlySet<JobStatus> = new Set([
  "uploaded",
  "awaiting_validation",
  "approved",
  "running",
]);

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
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

  const [files, [tiss], events] = await Promise.all([
    db.select().from(jobFiles).where(eq(jobFiles.jobId, jobId)).orderBy(asc(jobFiles.createdAt)),
    db.select().from(tissDocuments).where(eq(tissDocuments.jobId, jobId)).limit(1),
    db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(asc(jobEvents.createdAt)),
  ]);

  const workflow = buildJobWorkflowState(job, events);

  // Backward-compat: keep `file` as the first attached file so existing
  // clients still resolve a name; new clients should read `files[]`.
  return NextResponse.json({ ok: true, job, file: files[0] ?? null, files, tiss, events, workflow });
}

export async function DELETE(request: Request, { params }: RouteContext) {
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

  if (job.runId && liveStatuses.has(job.status)) {
    await getRun(job.runId)
      .cancel()
      .catch(() => {
        // If cancel fails, proceed with delete — DB is the source of truth for the user.
      });
  }

  await Promise.all([
    db.delete(jobs).where(eq(jobs.id, jobId)),
    db.insert(auditLogs).values({
      id: randomUUID(),
      userId: session.user.id,
      action: "job.deleted",
      entityType: "job",
      entityId: jobId,
      metadata: { previousStatus: job.status },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
