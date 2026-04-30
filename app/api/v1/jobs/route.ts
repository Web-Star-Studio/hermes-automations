import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireApiKeySession } from "@/lib/api-session";
import { db } from "@/lib/db";
import {
  auditLogs,
  jobFiles,
  jobs,
  platformCredentials,
  tissDocuments,
  type JobFlowType,
  type PlatformId,
} from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";
import { saveUpload } from "@/lib/storage/uploads";
import { tissBillingWorkflow } from "@/workflows/tiss-billing-workflow";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  try {
    const formData = await request.formData();

    const flowType: JobFlowType =
      formData.get("flowType") === "complete" ? "complete" : "short";

    const rawPlatformCredentialId = formData.get("platformCredentialId");
    const platformCredentialId =
      typeof rawPlatformCredentialId === "string" && rawPlatformCredentialId.trim().length > 0
        ? rawPlatformCredentialId.trim()
        : null;

    const rawFiles = formData.getAll("file").filter((f): f is File => f instanceof File);

    if (rawFiles.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "FILE_REQUIRED", message: "Pelo menos um arquivo (.zip ou .xml) e obrigatorio." },
        },
        { status: 400 },
      );
    }
    if (rawFiles.length > 50) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "TOO_MANY_FILES",
            message: "Limite maximo de 50 arquivos por envio (regra do portal Orizon Fature).",
          },
        },
        { status: 400 },
      );
    }

    let platformId: PlatformId | null = null;
    if (platformCredentialId) {
      const [credential] = await db
        .select({ id: platformCredentials.id, platformId: platformCredentials.platformId })
        .from(platformCredentials)
        .where(
          and(
            eq(platformCredentials.id, platformCredentialId),
            eq(platformCredentials.userId, session.userId),
          ),
        )
        .limit(1);
      if (!credential) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "CREDENTIAL_NOT_FOUND",
              message: "platformCredentialId nao pertence ao dono da API key.",
            },
          },
          { status: 400 },
        );
      }
      platformId = credential.platformId;
    }

    const savedAll = await Promise.all(rawFiles.map((file) => saveUpload(file, session.userId)));
    const jobId = randomUUID();

    await db.insert(jobs).values({
      id: jobId,
      userId: session.userId,
      status: "uploaded",
      flowType,
      platformId,
      platformCredentialId,
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
        message: `${savedAll.length} arquivo(s) TISS recebido(s) via API.`,
        payload: {
          flowType,
          fileCount: savedAll.length,
          autoApproveQueued: Boolean(platformCredentialId),
          files: savedAll.map((s) => ({ fileName: s.fileName, size: s.size, checksum: s.checksum })),
        },
      }),
      db.insert(auditLogs).values({
        id: randomUUID(),
        userId: session.userId,
        action: "api.job.created",
        entityType: "job",
        entityId: jobId,
        metadata: {
          apiKeyId: session.apiKeyId,
          flowType,
          fileCount: savedAll.length,
          totalSize: savedAll.reduce((acc, s) => acc + s.size, 0),
          fileNames: savedAll.map((s) => s.fileName),
          platformCredentialId,
          userAgent: request.headers.get("user-agent"),
        },
      }),
    ]);

    const run = await start(tissBillingWorkflow, [jobId]);

    await db.update(jobs).set({ runId: run.runId, updatedAt: new Date() }).where(eq(jobs.id, jobId));

    return NextResponse.json({
      ok: true,
      jobId,
      runId: run.runId,
      fileCount: savedAll.length,
      autoApproved: Boolean(platformCredentialId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar job.";
    return NextResponse.json(
      { ok: false, error: { code: "UPLOAD_FAILED", message } },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const baseRows = await db
    .select({ job: jobs, tiss: tissDocuments })
    .from(jobs)
    .leftJoin(tissDocuments, eq(tissDocuments.jobId, jobs.id))
    .where(eq(jobs.userId, session.userId))
    .orderBy(desc(jobs.createdAt))
    .limit(50);

  const jobIds = baseRows.map((r) => r.job.id);

  const [fileCounts, firstFiles] = jobIds.length
    ? await Promise.all([
        db
          .select({ jobId: jobFiles.jobId, count: count() })
          .from(jobFiles)
          .where(inArray(jobFiles.jobId, jobIds))
          .groupBy(jobFiles.jobId),
        db
          .select({
            jobId: jobFiles.jobId,
            fileName: jobFiles.fileName,
            createdAt: jobFiles.createdAt,
            rowNum:
              sql<number>`row_number() over (partition by ${jobFiles.jobId} order by ${jobFiles.createdAt} asc)`.as(
                "row_num",
              ),
          })
          .from(jobFiles)
          .where(inArray(jobFiles.jobId, jobIds)),
      ])
    : [[], []];

  const countByJob = new Map(fileCounts.map((c) => [c.jobId, c.count]));
  const firstByJob = new Map(
    firstFiles.filter((f) => f.rowNum === 1).map((f) => [f.jobId, f.fileName]),
  );

  return NextResponse.json({
    ok: true,
    jobs: baseRows.map(({ job, tiss }) => ({
      ...job,
      file: firstByJob.has(job.id) ? { fileName: firstByJob.get(job.id) ?? "" } : null,
      fileCount: countByJob.get(job.id) ?? 0,
      tiss,
    })),
  });
}
