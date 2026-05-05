import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobs, type PendingStepRecovery } from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";
import { requireApiSession } from "@/lib/session";
import { tissBillingWorkflow } from "@/workflows/tiss-billing-workflow";

const verbSchema = z.enum(["click", "fill", "select", "check", "scroll"]);

const resolutionSchema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("retry") }),
  z.object({ resolution: z.literal("skip") }),
  z.object({ resolution: z.literal("fail"), reason: z.string().optional() }),
  z.object({
    resolution: z.literal("manual_selector"),
    selector: z.string().min(1),
    verb: verbSchema.optional(),
  }),
]);

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { jobId } = await params;
  const body = resolutionSchema.parse(await request.json());

  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, session.user.id)))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { ok: false, error: { code: "JOB_NOT_FOUND", message: "Job não encontrado." } },
      { status: 404 },
    );
  }

  if (job.status !== "awaiting_recovery" || !job.pendingStepRecovery) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "JOB_NOT_AWAITING_RECOVERY",
          message: "Job não está aguardando recuperação de etapa.",
        },
      },
      { status: 409 },
    );
  }

  if (body.resolution === "fail") {
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage:
          body.reason ?? `Operador marcou etapa "${job.pendingStepRecovery.stepName}" como irrecuperável.`,
        pendingStepRecovery: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await appendJobEvent({
      jobId,
      type: "step_recovery_resolved",
      message: `Operador encerrou job no step "${job.pendingStepRecovery.stepName}".`,
      payload: {
        agentStep: "submit_tiss",
        toolName: "fillOrizonCredentials",
        nodeId: "step_recovery",
        status: "failed",
        stepName: job.pendingStepRecovery.stepName,
        resolution: "fail",
        reason: body.reason,
        redacted: true,
      },
    });

    return NextResponse.json({ ok: true });
  }

  // retry / skip / manual_selector all re-trigger the workflow. The runner
  // consults `pendingStepRecovery.operatorResolution` on the new run to decide
  // whether to short-circuit (manual_selector / skip) or just rerun normally
  // (retry).
  const updated: PendingStepRecovery = {
    ...job.pendingStepRecovery,
    operatorResolution: body,
  };

  await db
    .update(jobs)
    .set({
      status: "approved",
      pendingStepRecovery: body.resolution === "retry" ? null : updated,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  await appendJobEvent({
    jobId,
    type: "step_recovery_resolved",
    message: `Operador escolheu "${body.resolution}" para etapa "${job.pendingStepRecovery.stepName}".`,
    payload: {
      agentStep: "submit_tiss",
      toolName: "fillOrizonCredentials",
      nodeId: "step_recovery",
      status: "running",
      stepName: job.pendingStepRecovery.stepName,
      resolution: body.resolution,
      redacted: true,
    },
  });

  const run = await start(tissBillingWorkflow, [jobId]);
  await db.update(jobs).set({ runId: run.runId, updatedAt: new Date() }).where(eq(jobs.id, jobId));

  return NextResponse.json({ ok: true, runId: run.runId });
}
