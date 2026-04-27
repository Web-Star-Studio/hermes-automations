import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { auditLogs, jobFiles, jobs } from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";
import { requireApiSession } from "@/lib/session";
import { saveUpload } from "@/lib/storage/uploads";
import { tissBillingWorkflow } from "@/workflows/tiss-billing-workflow";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: { code: "FILE_REQUIRED", message: "Arquivo XML ou ZIP obrigatorio." } },
        { status: 400 },
      );
    }

    const saved = await saveUpload(file, session.user.id);
    const jobId = randomUUID();

    await db.insert(jobs).values({
      id: jobId,
      userId: session.user.id,
      status: "uploaded",
    });

    await Promise.all([
      db.insert(jobFiles).values({
        id: randomUUID(),
        jobId,
        fileName: saved.fileName,
        contentType: saved.contentType,
        size: String(saved.size),
        checksum: saved.checksum,
        blobUrl: saved.blobUrl,
        pathname: saved.pathname,
      }),
      appendJobEvent({
        jobId,
        type: "uploaded",
        message: "Arquivo TISS recebido.",
        payload: {
          fileName: saved.fileName,
          size: saved.size,
          checksum: saved.checksum,
        },
      }),
      db.insert(auditLogs).values({
        id: randomUUID(),
        userId: session.user.id,
        action: "job.uploaded",
        entityType: "job",
        entityId: jobId,
        metadata: { fileName: saved.fileName, size: saved.size },
      }),
    ]);

    const run = await start(tissBillingWorkflow, [jobId]);

    await db.update(jobs).set({ runId: run.runId, updatedAt: new Date() }).where(eq(jobs.id, jobId));

    return NextResponse.json({ ok: true, jobId, runId: run.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar job.";
    return NextResponse.json(
      { ok: false, error: { code: "UPLOAD_FAILED", message } },
      { status: 400 },
    );
  }
}
