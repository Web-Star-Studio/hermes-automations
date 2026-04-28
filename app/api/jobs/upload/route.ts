import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { auditLogs, jobFiles, jobs, type JobFlowType } from "@/lib/db/schema";
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
    const flowType: JobFlowType =
      formData.get("flowType") === "complete" ? "complete" : "short";

    const rawFiles = formData.getAll("file").filter((f): f is File => f instanceof File);

    if (rawFiles.length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "FILE_REQUIRED", message: "Pelo menos um arquivo XML ou ZIP é obrigatório." } },
        { status: 400 },
      );
    }
    if (rawFiles.length > 50) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "TOO_MANY_FILES",
            message: "Limite máximo de 50 arquivos por envio (regra do portal Orizon Fature).",
          },
        },
        { status: 400 },
      );
    }

    const savedAll = await Promise.all(rawFiles.map((file) => saveUpload(file, session.user.id)));
    const jobId = randomUUID();

    await db.insert(jobs).values({
      id: jobId,
      userId: session.user.id,
      status: "uploaded",
      flowType,
    });

    await Promise.all([
      db.insert(jobFiles).values(
        savedAll.map((saved) => ({
          id: randomUUID(),
          jobId,
          fileName: saved.fileName,
          contentType: saved.contentType,
          size: String(saved.size),
          checksum: saved.checksum,
          blobUrl: saved.blobUrl,
          pathname: saved.pathname,
        })),
      ),
      appendJobEvent({
        jobId,
        type: "uploaded",
        message: `${savedAll.length} arquivo(s) TISS recebido(s).`,
        payload: {
          flowType,
          fileCount: savedAll.length,
          files: savedAll.map((s) => ({ fileName: s.fileName, size: s.size, checksum: s.checksum })),
        },
      }),
      db.insert(auditLogs).values({
        id: randomUUID(),
        userId: session.user.id,
        action: "job.uploaded",
        entityType: "job",
        entityId: jobId,
        metadata: {
          flowType,
          fileCount: savedAll.length,
          totalSize: savedAll.reduce((acc, s) => acc + s.size, 0),
          fileNames: savedAll.map((s) => s.fileName),
        },
      }),
    ]);

    const run = await start(tissBillingWorkflow, [jobId]);

    await db.update(jobs).set({ runId: run.runId, updatedAt: new Date() }).where(eq(jobs.id, jobId));

    return NextResponse.json({ ok: true, jobId, runId: run.runId, fileCount: savedAll.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar job.";
    return NextResponse.json(
      { ok: false, error: { code: "UPLOAD_FAILED", message } },
      { status: 400 },
    );
  }
}
