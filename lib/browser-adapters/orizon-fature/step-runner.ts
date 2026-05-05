import type { Locator, Page } from "playwright-core";
import { findElementWithVision as defaultFindElementWithVision } from "@/lib/ai/vision";
import {
  type FieldSnapshot,
  snapshotPageFields,
} from "@/lib/orizon/runtime-introspection";

// Universal step runner: every browser action goes through `runStep` so we get
// uniform try → verify → alternatives → vision-with-feedback → human-recovery
// behavior across the whole adapter. Adding a new step is "declare its goal,
// declare its verify(), drop in attempt() — vision recovery comes for free."

export type VisionAttemptVerb = "click" | "fill" | "select" | "check" | "scroll";

export type StepRecoveryPayload = {
  stepName: string;
  goal: string;
  attemptsUsed: number;
  lastError: string;
  visionSummaries: Array<{ approach: string; outcome: string }>;
  screenshot?: Buffer;
  domSnapshot?: FieldSnapshot | null;
  context?: { pageId?: string; modalId?: string; elementId?: string };
};

export type StepRecoveryResolution =
  | { resolution: "retry" }
  | { resolution: "skip" }
  | { resolution: "fail"; reason?: string }
  | { resolution: "manual_selector"; selector: string; verb?: VisionAttemptVerb };

export type StepProgressEvent =
  | { stage: "step_started"; stepName: string; goal: string }
  | { stage: "step_succeeded"; stepName: string; durationMs: number; attemptsUsed: number }
  | { stage: "step_alternative_used"; stepName: string; alternativeName: string }
  | {
      stage: "vision_recovery";
      stepName: string;
      intent: string;
      selector?: string;
      attemptIndex: number;
      previousAttemptCount: number;
    }
  | { stage: "step_unrecoverable"; stepName: string; reason: string; attemptsUsed: number };

export type StepDescriptor<T = void> = {
  /** Stable id used in events/telemetry, e.g. "submit_batches". */
  name: string;
  /** English LLM intent: "Click the orange Enviar button at the bottom of the upload list…". */
  goal: string;
  /** Optional portal-map context the runner forwards into `findElementWithVision`. */
  context?: { pageId?: string; modalId?: string; elementId?: string };
  /** Deterministic primary action. The runner times this and emits step_started/succeeded around it. */
  attempt: () => Promise<T>;
  /**
   * Post-condition. Returning `false` is treated identically to `attempt()` throwing —
   * the runner falls back to alternatives → vision → human recovery. If omitted, the
   * runner trusts that a non-throwing `attempt()` succeeded.
   */
  verify?: () => Promise<boolean>;
  /** Pre-defined fallbacks (e.g., select via label, then via keyboard typeahead). Tried in order. */
  alternatives?: Array<{ name: string; run: () => Promise<T> }>;
  /** Translates a vision-suggested locator into a domain action. Default: `locator.click()`. */
  visionAction?: (locator: Locator, page: Page) => Promise<T>;
  /** Per-step override for vision retry budget. Default 3. */
  maxVisionAttempts?: number;
  /** Skip vision and escalate straight to human recovery (e.g., file uploads). */
  unrecoverable?: boolean;
};

export type StepRunOptions = {
  page: Page;
  jobId: string;
  visionEnabled: boolean;
  /**
   * Telemetry emitter. The adapter wires this through `OrizonProgressEvent` so
   * `emitSubmitProgress` can persist a `jobEvents` row.
   */
  onProgress?: (event: StepProgressEvent) => Promise<void> | void;
  /**
   * Called after deterministic + alternatives + vision retries all fail.
   * Production wiring persists the payload + throws FatalError so the workflow
   * surfaces a recovery panel; tests can inject a fake to assert the payload.
   */
  awaitHumanRecovery: (payload: StepRecoveryPayload) => Promise<StepRecoveryResolution>;
  /**
   * DI seam. Tests pass a mock that returns canned `ElementLocation` responses
   * to exercise iterative vision, exhaustion, and feedback wiring without
   * hitting the real Vercel AI Gateway.
   */
  findElementWithVision?: typeof defaultFindElementWithVision;
};

export class StepRecoveryRequired extends Error {
  payload: StepRecoveryPayload;
  resolution: StepRecoveryResolution;
  constructor(payload: StepRecoveryPayload, resolution: StepRecoveryResolution) {
    super(`Step "${payload.stepName}" requires human recovery: ${payload.lastError}`);
    this.name = "StepRecoveryRequired";
    this.payload = payload;
    this.resolution = resolution;
  }
}

export async function runStep<T>(
  step: StepDescriptor<T>,
  opts: StepRunOptions,
): Promise<T> {
  const startedAt = Date.now();
  const visionFn = opts.findElementWithVision ?? defaultFindElementWithVision;
  const visionSummaries: Array<{ approach: string; outcome: string }> = [];
  let lastError = "";

  await opts.onProgress?.({ stage: "step_started", stepName: step.name, goal: step.goal });

  // 1. Deterministic primary attempt.
  const primary = await tryAndVerify(step.attempt, step.verify, "deterministic primary");
  if (primary.ok) {
    await opts.onProgress?.({
      stage: "step_succeeded",
      stepName: step.name,
      durationMs: Date.now() - startedAt,
      attemptsUsed: 1,
    });
    return primary.value;
  }
  lastError = primary.error;
  visionSummaries.push({ approach: "deterministic primary", outcome: primary.error });

  // 2. Pre-defined alternatives.
  const alternatives = step.alternatives ?? [];
  for (const alt of alternatives) {
    await opts.onProgress?.({
      stage: "step_alternative_used",
      stepName: step.name,
      alternativeName: alt.name,
    });
    const altResult = await tryAndVerify(alt.run, step.verify, `alternative "${alt.name}"`);
    if (altResult.ok) {
      await opts.onProgress?.({
        stage: "step_succeeded",
        stepName: step.name,
        durationMs: Date.now() - startedAt,
        attemptsUsed: 2 + alternatives.indexOf(alt),
      });
      return altResult.value;
    }
    lastError = altResult.error;
    visionSummaries.push({ approach: `alternative "${alt.name}"`, outcome: altResult.error });
  }

  // 3. Vision loop with feedback. Each retry tells the LLM what previous attempts
  // tried and why they failed so it can self-correct.
  if (opts.visionEnabled && !step.unrecoverable) {
    const maxAttempts = step.maxVisionAttempts ?? 3;
    for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex++) {
      const visionOutcome = await tryVision({
        step,
        opts,
        visionFn,
        attemptIndex,
        previousAttempts: [...visionSummaries],
      });
      if (visionOutcome.ok) {
        await opts.onProgress?.({
          stage: "step_succeeded",
          stepName: step.name,
          durationMs: Date.now() - startedAt,
          attemptsUsed: 1 + alternatives.length + attemptIndex,
        });
        return visionOutcome.value;
      }
      lastError = visionOutcome.error;
      visionSummaries.push({
        approach: `vision attempt ${attemptIndex}${
          visionOutcome.suggestedSelector ? ` (selector: ${visionOutcome.suggestedSelector})` : ""
        }`,
        outcome: visionOutcome.error,
      });
    }
  }

  // 4. Escalate to human recovery.
  const attemptsUsed = 1 + alternatives.length + (opts.visionEnabled && !step.unrecoverable ? (step.maxVisionAttempts ?? 3) : 0);
  await opts.onProgress?.({
    stage: "step_unrecoverable",
    stepName: step.name,
    reason: lastError,
    attemptsUsed,
  });

  const screenshot = await opts.page.screenshot({ type: "jpeg", quality: 70 }).catch(() => undefined);
  const domSnapshot = await snapshotPageFields(opts.page).catch(() => null);

  const payload: StepRecoveryPayload = {
    stepName: step.name,
    goal: step.goal,
    attemptsUsed,
    lastError,
    visionSummaries,
    screenshot,
    domSnapshot,
    context: step.context,
  };

  const resolution = await opts.awaitHumanRecovery(payload);

  // The workflow-side resolver decides what to do. The runner just enforces
  // the resolution and surfaces it back to the caller via StepRecoveryRequired
  // for retry/skip/fail cases, or runs a manual selector when the operator
  // supplied one.
  if (resolution.resolution === "manual_selector") {
    const locator = opts.page.locator(resolution.selector).first();
    const visionAction = step.visionAction ?? defaultVisionAction;
    try {
      const value = await visionAction(locator, opts.page);
      const verifyOk = step.verify ? await step.verify().catch(() => false) : true;
      if (!verifyOk) {
        throw new StepRecoveryRequired(payload, {
          resolution: "fail",
          reason: "manual selector did not satisfy verify()",
        });
      }
      await opts.onProgress?.({
        stage: "step_succeeded",
        stepName: step.name,
        durationMs: Date.now() - startedAt,
        attemptsUsed: attemptsUsed + 1,
      });
      return value;
    } catch (err) {
      throw new StepRecoveryRequired(payload, {
        resolution: "fail",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // For retry/skip/fail the workflow side has already persisted the payload
  // and decided the next action; we throw so the outer step can act on it.
  throw new StepRecoveryRequired(payload, resolution);
}

async function tryAndVerify<T>(
  attempt: () => Promise<T>,
  verify: (() => Promise<boolean>) | undefined,
  approach: string,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await attempt();
    if (verify) {
      const ok = await verify().catch((err) => {
        throw new Error(`verify threw: ${err instanceof Error ? err.message : String(err)}`);
      });
      if (!ok) {
        return { ok: false, error: `${approach}: verify() returned false` };
      }
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: `${approach}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function tryVision<T>(args: {
  step: StepDescriptor<T>;
  opts: StepRunOptions;
  visionFn: typeof defaultFindElementWithVision;
  attemptIndex: number;
  previousAttempts: Array<{ approach: string; outcome: string }>;
}): Promise<
  | { ok: true; value: T }
  | { ok: false; error: string; suggestedSelector?: string }
> {
  const { step, opts, visionFn, attemptIndex, previousAttempts } = args;

  const screenshot = await opts.page.screenshot({ type: "jpeg", quality: 70 }).catch(() => null);
  if (!screenshot) {
    return { ok: false, error: `vision attempt ${attemptIndex}: failed to take screenshot` };
  }

  const domSnapshot = await snapshotPageFields(opts.page).catch(() => null);

  let location;
  try {
    location = await visionFn({
      screenshot,
      goal: step.goal,
      pageId: step.context?.pageId,
      elementId: step.context?.elementId,
      previousAttempts,
      domSnapshot: domSnapshot ?? undefined,
    });
  } catch (err) {
    return {
      ok: false,
      error: `vision attempt ${attemptIndex}: model call failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!location.found || (!location.selector && !location.textHint)) {
    return {
      ok: false,
      error: `vision attempt ${attemptIndex}: not found (${location.reason ?? "no reason"})`,
    };
  }

  const locator = locatorFromVision(opts.page, location.selector, location.textHint);

  await opts.onProgress?.({
    stage: "vision_recovery",
    stepName: step.name,
    intent: step.goal,
    selector: location.selector,
    attemptIndex,
    previousAttemptCount: previousAttempts.length,
  });

  const visionAction = step.visionAction ?? defaultVisionAction;
  try {
    const value = await visionAction(locator, opts.page);
    const verifyOk = step.verify ? await step.verify().catch(() => false) : true;
    if (!verifyOk) {
      return {
        ok: false,
        error: `vision attempt ${attemptIndex}: verify() returned false after ${
          location.actionVerb ?? "click"
        } on ${location.selector ?? `text "${location.textHint}"`}`,
        suggestedSelector: location.selector,
      };
    }
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: `vision attempt ${attemptIndex}: action threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
      suggestedSelector: location.selector,
    };
  }
}

function locatorFromVision(
  page: Page,
  selector: string | undefined,
  textHint: string | undefined,
): Locator {
  if (selector) {
    const sel = page.locator(selector).first();
    if (textHint) {
      return sel.or(page.getByText(textHint, { exact: false }).first()).first();
    }
    return sel;
  }
  // textHint is the only handle we have left.
  return page.getByText(textHint!, { exact: false }).first();
}

async function defaultVisionAction<T>(locator: Locator): Promise<T> {
  await locator.click({ timeout: 5_000 });
  return undefined as T;
}
