import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiKeySession } from "@/lib/api-session";
import { db } from "@/lib/db";
import { jobEvents, jobFiles, jobs, tissDocuments } from "@/lib/db/schema";
import { buildJobWorkflowState } from "@/lib/jobs/workflow-visualization";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
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

  return NextResponse.json({
    ok: true,
    job,
    file: files[0] ?? null,
    files,
    tiss,
    events,
    workflow,
  });
}
