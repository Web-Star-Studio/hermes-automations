import { describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright-core";
import {
  runStep,
  StepRecoveryRequired,
  type StepDescriptor,
  type StepProgressEvent,
  type StepRecoveryPayload,
  type StepRecoveryResolution,
  type StepRunOptions,
} from "@/lib/browser-adapters/orizon-fature/step-runner";
import type { ElementLocation, FindElementWithVisionInput } from "@/lib/ai/vision";

// The runner takes Page only to grab screenshots and build locators on vision
// recovery. Tests stub both with no-ops; the screenshot Buffer is opaque to
// `findElementWithVision` mocks.
function fakePage(reloadSpy?: ReturnType<typeof vi.fn>): Page {
  const stubLocator = {
    click: vi.fn(async () => undefined),
    first: () => stubLocator,
    or: () => stubLocator,
  } as unknown as Locator;
  return {
    screenshot: vi.fn(async () => Buffer.from("png")),
    locator: () => stubLocator,
    getByText: () => stubLocator,
    reload: reloadSpy ?? vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
  } as unknown as Page;
}

function captureProgress(events: StepProgressEvent[]): StepRunOptions["onProgress"] {
  return (event) => {
    events.push(event);
  };
}

const noopVision = vi.fn(async (_input: FindElementWithVisionInput): Promise<ElementLocation> => ({
  found: false,
  reason: "test mock — vision should not have been invoked",
}));

const noopRecovery = vi.fn(async (_payload: StepRecoveryPayload): Promise<StepRecoveryResolution> => ({
  resolution: "fail",
  reason: "test default — recovery should not have been invoked",
}));

describe("runStep", () => {
  it("returns the deterministic value when verify passes on the first attempt", async () => {
    const events: StepProgressEvent[] = [];
    const verify = vi.fn(async () => true);
    const visionFn = vi.fn(noopVision);

    const step: StepDescriptor<string> = {
      name: "happy_path",
      goal: "Click the orange Enviar button.",
      attempt: async () => "primary-result",
      verify,
    };

    const result = await runStep(step, {
      page: fakePage(),
      jobId: "job-1",
      visionEnabled: true,
      onProgress: captureProgress(events),
      awaitHumanRecovery: noopRecovery,
      findElementWithVision: visionFn,
    });

    expect(result).toBe("primary-result");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(visionFn).not.toHaveBeenCalled();
    expect(noopRecovery).not.toHaveBeenCalled();
    expect(events.map((e) => e.stage)).toEqual(["step_started", "step_succeeded"]);
  });

  it("tries pre-defined alternatives in order and returns the first that verifies", async () => {
    const events: StepProgressEvent[] = [];
    const visionFn = vi.fn(noopVision);
    const calls: string[] = [];

    const step: StepDescriptor<string> = {
      name: "alt_chain",
      goal: "Select the operadora by ANS.",
      attempt: async () => {
        calls.push("primary");
        throw new Error("primary blew up");
      },
      verify: async () => calls.includes("alt-2"),
      alternatives: [
        {
          name: "alt-1",
          run: async () => {
            calls.push("alt-1");
            return "alt-1-value";
          },
        },
        {
          name: "alt-2",
          run: async () => {
            calls.push("alt-2");
            return "alt-2-value";
          },
        },
      ],
    };

    const result = await runStep(step, {
      page: fakePage(),
      jobId: "job-2",
      visionEnabled: true,
      onProgress: captureProgress(events),
      awaitHumanRecovery: noopRecovery,
      findElementWithVision: visionFn,
    });

    expect(result).toBe("alt-2-value");
    expect(calls).toEqual(["primary", "alt-1", "alt-2"]);
    expect(visionFn).not.toHaveBeenCalled();
    expect(events.filter((e) => e.stage === "step_alternative_used")).toHaveLength(2);
  });

  it("invokes vision once when alternatives exhaust, with no previous-attempt feedback on the first vision call", async () => {
    const events: StepProgressEvent[] = [];
    let verifyOk = false;

    const visionFn = vi.fn(async (input: FindElementWithVisionInput): Promise<ElementLocation> => {
      // First and only vision call should NOT include previousAttempts containing
      // a vision summary (only the deterministic + alternative entries).
      const visionAttempts = (input.previousAttempts ?? []).filter((a) =>
        a.approach.startsWith("vision attempt"),
      );
      expect(visionAttempts).toHaveLength(0);
      verifyOk = true;
      return { found: true, selector: ".orange-enviar", reason: "found by text" };
    });

    const step: StepDescriptor<void> = {
      name: "submit_batches",
      goal: "Click Enviar.",
      attempt: async () => {
        throw new Error("primary timeout");
      },
      verify: async () => verifyOk,
    };

    await runStep(step, {
      page: fakePage(),
      jobId: "job-3",
      visionEnabled: true,
      onProgress: captureProgress(events),
      awaitHumanRecovery: noopRecovery,
      findElementWithVision: visionFn,
    });

    expect(visionFn).toHaveBeenCalledTimes(1);
    const visionEvents = events.filter((e) => e.stage === "vision_recovery");
    expect(visionEvents).toHaveLength(1);
    if (visionEvents[0].stage === "vision_recovery") {
      expect(visionEvents[0].attemptIndex).toBe(1);
      expect(visionEvents[0].previousAttemptCount).toBe(1); // 1 deterministic failure
    }
  });

  it("retries vision iteratively and feeds previous-attempt outcomes into the next call", async () => {
    const events: StepProgressEvent[] = [];
    let verifyOk = false;
    const seenPrevious: Array<Array<{ approach: string; outcome: string }>> = [];

    const visionFn = vi.fn(async (input: FindElementWithVisionInput): Promise<ElementLocation> => {
      seenPrevious.push([...(input.previousAttempts ?? [])]);
      // First vision call: suggest a bad selector (verify() fails after click).
      // Second vision call: suggest a good selector.
      if (seenPrevious.length === 1) {
        return { found: true, selector: ".bad", reason: "tried bad first" };
      }
      verifyOk = true;
      return { found: true, selector: ".good", reason: "second try worked" };
    });

    const step: StepDescriptor<void> = {
      name: "click_terminar",
      goal: "Dismiss tour overlay.",
      attempt: async () => {
        throw new Error("no terminar button");
      },
      verify: async () => verifyOk,
    };

    await runStep(step, {
      page: fakePage(),
      jobId: "job-4",
      visionEnabled: true,
      onProgress: captureProgress(events),
      awaitHumanRecovery: noopRecovery,
      findElementWithVision: visionFn,
    });

    expect(visionFn).toHaveBeenCalledTimes(2);
    // Second call must include the first vision attempt's outcome in feedback.
    const secondCallPrevious = seenPrevious[1];
    expect(secondCallPrevious.some((a) => a.approach.startsWith("vision attempt 1"))).toBe(true);
    expect(secondCallPrevious[secondCallPrevious.length - 1].outcome).toMatch(/verify\(\) returned false/);
  });

  it("escalates to awaitHumanRecovery when all 3 vision attempts fail and propagates the resolution via StepRecoveryRequired", async () => {
    const visionFn = vi.fn(
      async (): Promise<ElementLocation> => ({ found: false, reason: "cannot see element" }),
    );
    const recovery = vi.fn(
      async (_payload: StepRecoveryPayload): Promise<StepRecoveryResolution> => ({
        resolution: "fail",
        reason: "operator marked unrecoverable",
      }),
    );

    const step: StepDescriptor<void> = {
      name: "select_tipo_guia",
      goal: "Choose tipo de guia from dropdown.",
      attempt: async () => {
        throw new Error("dropdown not found");
      },
      verify: async () => false,
      maxVisionAttempts: 3,
    };

    await expect(
      runStep(step, {
        page: fakePage(),
        jobId: "job-5",
        visionEnabled: true,
        awaitHumanRecovery: recovery,
        findElementWithVision: visionFn,
      }),
    ).rejects.toBeInstanceOf(StepRecoveryRequired);

    expect(visionFn).toHaveBeenCalledTimes(3);
    expect(recovery).toHaveBeenCalledTimes(1);
    const payload = recovery.mock.calls[0][0];
    expect(payload.stepName).toBe("select_tipo_guia");
    expect(payload.attemptsUsed).toBeGreaterThanOrEqual(4); // 1 deterministic + 3 vision
    expect(payload.visionSummaries.length).toBeGreaterThanOrEqual(4);
  });

  it("skips vision and escalates straight to recovery when visionEnabled is false", async () => {
    const visionFn = vi.fn(noopVision);
    const recovery = vi.fn(
      async (): Promise<StepRecoveryResolution> => ({ resolution: "skip" }),
    );

    const step: StepDescriptor<void> = {
      name: "accept_cookies",
      goal: "Accept cookie banner.",
      attempt: async () => {
        throw new Error("no banner");
      },
    };

    await expect(
      runStep(step, {
        page: fakePage(),
        jobId: "job-6",
        visionEnabled: false,
        awaitHumanRecovery: recovery,
        findElementWithVision: visionFn,
      }),
    ).rejects.toBeInstanceOf(StepRecoveryRequired);

    expect(visionFn).not.toHaveBeenCalled();
    expect(recovery).toHaveBeenCalledTimes(1);
  });

  it("reloads the page once before vision when recoverWithReload is true and the primary fails fast", async () => {
    const events: StepProgressEvent[] = [];
    const reloadSpy = vi.fn(async () => undefined);
    let attemptCalls = 0;
    let postReload = false;

    const visionFn = vi.fn(noopVision);
    const step: StepDescriptor<void> = {
      name: "stuck_modal_backdrop",
      goal: "Click Enviar.",
      attempt: async () => {
        attemptCalls++;
        // First call fails (verify will reject); after reload the second
        // call sees postReload=true and the verify accepts.
        if (attemptCalls > 1) postReload = true;
      },
      verify: async () => postReload,
      recoverWithReload: true,
    };

    await runStep(step, {
      page: fakePage(reloadSpy),
      jobId: "job-7",
      visionEnabled: true,
      onProgress: captureProgress(events),
      awaitHumanRecovery: noopRecovery,
      findElementWithVision: visionFn,
    });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(attemptCalls).toBe(2); // primary + post-reload retry
    expect(visionFn).not.toHaveBeenCalled();
    const reloadEvent = events.find((e) => e.stage === "step_stuck_reload");
    expect(reloadEvent).toBeDefined();
    if (reloadEvent && reloadEvent.stage === "step_stuck_reload") {
      expect(reloadEvent.reason).toBe("pre_vision");
    }
  });

  it("the watchdog reloads + retries when the primary attempt hangs past stuckAfterMs", async () => {
    const events: StepProgressEvent[] = [];
    const reloadSpy = vi.fn(async () => undefined);
    let attemptCalls = 0;

    const step: StepDescriptor<void> = {
      name: "watchdog_reload",
      goal: "Click something.",
      attempt: async () => {
        attemptCalls++;
        if (attemptCalls === 1) {
          // First call hangs forever — watchdog should fire.
          await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
        // Second call (post-reload retry) returns immediately.
      },
      verify: async () => attemptCalls >= 2,
      recoverWithReload: true,
      stuckAfterMs: 50, // tiny so the test runs fast
    };

    await runStep(step, {
      page: fakePage(reloadSpy),
      jobId: "job-8",
      visionEnabled: true,
      onProgress: captureProgress(events),
      awaitHumanRecovery: noopRecovery,
      findElementWithVision: vi.fn(noopVision),
    });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const reloadEvent = events.find((e) => e.stage === "step_stuck_reload");
    expect(reloadEvent).toBeDefined();
    if (reloadEvent && reloadEvent.stage === "step_stuck_reload") {
      expect(reloadEvent.reason).toBe("watchdog");
    }
  });
});
