import { describe, expect, it } from "vitest";
import { buildJobWorkflowState } from "@/lib/jobs/workflow-visualization";

describe("buildJobWorkflowState", () => {
  it("marks the human validation node as awaiting human from agent events", () => {
    const state = buildJobWorkflowState(
      { status: "awaiting_validation" },
      [
        {
          id: "evt_1",
          type: "human_validation_requested",
          message: "Aguardando validacao.",
          createdAt: new Date(),
          payload: {
            nodeId: "human_validation",
            status: "awaiting_human",
            redacted: true,
          },
        },
      ],
    );

    expect(state.activeNodeId).toBe("human_validation");
    expect(state.nodes.find((node) => node.id === "human_validation")?.status).toBe(
      "awaiting_human",
    );
  });

  it("maps a successful login + submit to complete", () => {
    const state = buildJobWorkflowState(
      { status: "login_succeeded" },
      [
        {
          id: "evt_1",
          type: "browser_action_completed",
          message: "Login concluido.",
          createdAt: new Date(),
          payload: {
            nodeId: "orizon_login",
            status: "success",
            redacted: true,
          },
        },
        {
          id: "evt_2",
          type: "submit_tiss_completed",
          message: "Lote enviado.",
          createdAt: new Date(),
          payload: {
            nodeId: "submit_tiss",
            status: "success",
            redacted: true,
          },
        },
      ],
    );

    expect(state.activeNodeId).toBe("complete");
    expect(state.nodes.find((node) => node.id === "complete")?.status).toBe("success");
    expect(state.nodes.find((node) => node.id === "orizon_login")?.status).toBe("success");
    expect(state.nodes.find((node) => node.id === "submit_tiss")?.status).toBe("success");
  });

  it("keeps submit_tiss running when login succeeded but submit hasn't confirmed yet", () => {
    const state = buildJobWorkflowState(
      { status: "login_succeeded" },
      [
        {
          id: "evt_1",
          type: "browser_action_completed",
          message: "Login concluido.",
          createdAt: new Date(),
          payload: { nodeId: "orizon_login", status: "success", redacted: true },
        },
      ],
    );

    expect(state.nodes.find((node) => node.id === "submit_tiss")?.status).toBe("running");
    expect(state.nodes.find((node) => node.id === "complete")?.status).toBe("pending");
  });
});
