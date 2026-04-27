import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, jobs, platformCredentials } from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";
import { ensurePlatform } from "@/lib/platforms";
import { requireApiSession } from "@/lib/session";

const resumeSchema = z.object({
  platformId: z.literal("orizon_fature"),
  platformCredentialId: z.string().min(1),
  validatedData: z.record(z.string(), z.unknown()).default({}),
});

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { jobId } = await params;
  const body = resumeSchema.parse(await request.json());

  const [[job], [credential]] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, session.user.id)))
      .limit(1),
    db
      .select({ id: platformCredentials.id })
      .from(platformCredentials)
      .where(
        and(
          eq(platformCredentials.id, body.platformCredentialId),
          eq(platformCredentials.userId, session.user.id),
        ),
      )
      .limit(1),
    ensurePlatform(body.platformId),
  ]);

  if (!job?.validationHookToken) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "JOB_NOT_WAITING", message: "Job nao esta aguardando validacao." },
      },
      { status: 409 },
    );
  }

  if (!credential) {
    return NextResponse.json(
      { ok: false, error: { code: "CREDENTIAL_NOT_FOUND", message: "Credencial nao encontrada." } },
      { status: 404 },
    );
  }

  await Promise.all([
    db
      .update(jobs)
      .set({
        status: "approved",
        platformId: body.platformId,
        platformCredentialId: body.platformCredentialId,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId)),
    appendJobEvent({
      jobId,
      type: "validation_approved",
      message: "Validacao humana aprovada.",
      payload: {
        agentStep: "request_human_validation",
        toolName: "requestHumanValidation",
        nodeId: "human_validation",
        status: "success",
        redacted: true,
        platformId: body.platformId,
      },
    }),
    db.insert(auditLogs).values({
      id: randomUUID(),
      userId: session.user.id,
      action: "job.validation_approved",
      entityType: "job",
      entityId: jobId,
      metadata: { platformId: body.platformId },
    }),
  ]);

  await resumeHook(job.validationHookToken, body);

  return NextResponse.json({ ok: true });
}
