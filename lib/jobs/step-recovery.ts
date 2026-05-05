import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, type PendingStepRecovery } from "@/lib/db/schema";
import { appendJobEvent } from "@/lib/jobs/events";
import { saveBytes } from "@/lib/storage/bytes";
import type {
  StepRecoveryPayload,
  StepRecoveryResolution,
} from "@/lib/browser-adapters/orizon-fature/step-runner";

// The runner cannot synchronously suspend a workflow run while keeping the
// Browserbase session alive — sessions are external resources that close on
// process exit, and the durable agent serializes its own state separately.
// So escalation works like this: persist the diagnostic to `jobs.pendingStepRecovery`,
// emit a `step_unrecoverable` event, and return `{ resolution: "fail", … }` to
// the runner. The runner throws StepRecoveryRequired, the outer step throws
// FatalError, and the workflow ends in `awaiting_recovery`. The operator's
// resolution arrives via /api/jobs/[jobId]/resume-recovery, which clears or
// updates `pendingStepRecovery` and triggers a fresh workflow run. On that run,
// `loadStepOverride()` lets the runner short-circuit straight to the operator's
// manual selector when one was provided.

export async function persistStepRecovery(
  jobId: string,
  payload: StepRecoveryPayload,
): Promise<{ screenshotKey: string | null; snapshotKey: string | null }> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const baseKey = `jobs/${jobId}/step-recovery/${payload.stepName}-${ts}`;

  let screenshotKey: string | null = null;
  if (payload.screenshot) {
    const stored = await saveBytes(`${baseKey}.jpg`, payload.screenshot, "image/jpeg").catch(
      () => null,
    );
    screenshotKey = stored?.pathname ?? null;
  }

  let snapshotKey: string | null = null;
  if (payload.domSnapshot) {
    const stored = await saveBytes(
      `${baseKey}-snapshot.json`,
      Buffer.from(JSON.stringify(payload.domSnapshot, null, 2)),
      "application/json",
    ).catch(() => null);
    snapshotKey = stored?.pathname ?? null;
  }

  const pending: PendingStepRecovery = {
    stepName: payload.stepName,
    goal: payload.goal,
    attemptsUsed: payload.attemptsUsed,
    lastError: payload.lastError,
    visionSummaries: payload.visionSummaries,
    screenshotKey,
    snapshotKey,
    context: payload.context,
    suspendedAt: new Date().toISOString(),
  };

  await db
    .update(jobs)
    .set({ status: "awaiting_recovery", pendingStepRecovery: pending, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));

  await appendJobEvent({
    jobId,
    type: "step_unrecoverable",
    message: `Etapa "${payload.stepName}" exauriu retentativas e aguarda decisão do operador.`,
    payload: {
      agentStep: "submit_tiss",
      toolName: "fillOrizonCredentials",
      nodeId: "step_recovery",
      status: "awaiting_human",
      stepName: payload.stepName,
      goal: payload.goal,
      attemptsUsed: payload.attemptsUsed,
      lastError: payload.lastError,
      screenshotKey,
      snapshotKey,
      redacted: true,
    },
  });

  return { screenshotKey, snapshotKey };
}

/**
 * Build the awaitHumanRecovery callback the runner will invoke when retries
 * exhaust. Returns "fail" so the runner throws StepRecoveryRequired up through
 * the outer step — the operator's actual resolution arrives on a future
 * workflow run via `loadStepOverride()`.
 */
export function createAwaitHumanRecovery(jobId: string) {
  return async (payload: StepRecoveryPayload): Promise<StepRecoveryResolution> => {
    await persistStepRecovery(jobId, payload);
    return {
      resolution: "fail",
      reason: "Job pausado para decisão do operador (awaiting_recovery).",
    };
  };
}

/**
 * Read the operator's resolution stored from a previous run, if any. The
 * adapter consults this when starting each step so it can short-circuit to a
 * manual_selector or skip when the operator has already weighed in.
 */
export async function loadStepOverride(
  jobId: string,
  stepName: string,
): Promise<PendingStepRecovery["operatorResolution"] | null> {
  const [job] = await db
    .select({ pending: jobs.pendingStepRecovery })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  const pending = job?.pending;
  if (!pending || pending.stepName !== stepName) return null;
  return pending.operatorResolution ?? null;
}

export async function clearStepRecovery(jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ pendingStepRecovery: null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
