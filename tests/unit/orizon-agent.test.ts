import { describe, expect, it } from "vitest";
import {
  buildOrizonBillingAgentInstructions,
  getOrizonBillingAgentToolNames,
} from "@/lib/agents/orizon-billing-agent-config";

describe("Hermes agent configuration", () => {
  it("registers browserbase, web search and secure credential tools", () => {
    const tools = getOrizonBillingAgentToolNames();

    expect(tools).toContain("ingestTiss");
    expect(tools).toContain("requestHumanValidation");
    expect(tools).toContain("fillOrizonCredentials");
    expect(tools).toContain("webSearch");
    expect(tools).toContain("browserbase_stagehand_session_start");
  });

  it("registers granular portal-action tools", () => {
    const tools = getOrizonBillingAgentToolNames();
    expect(tools).toContain("openPortalSession");
    expect(tools).toContain("runPortalActions");
    expect(tools).toContain("closePortalSession");
  });

  it("identifies as Hermes and grounds web searches publicly", () => {
    const instructions = buildOrizonBillingAgentInstructions();

    expect(instructions).toContain("Hermes");
    expect(instructions.toLowerCase()).toContain("websearch");
    expect(instructions.toLowerCase()).toContain("ans");
    expect(instructions.toLowerCase()).toContain("tuss");
  });

  it("keeps passwords outside the model instructions", () => {
    const instructions = buildOrizonBillingAgentInstructions().toLowerCase();

    expect(instructions).toContain("fillorizoncredentials");
    expect(instructions).toContain("nunca");
    expect(instructions).not.toContain("senha=");
    expect(instructions).not.toContain("password=");
  });
});
