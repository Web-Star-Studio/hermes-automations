import { generateObject } from "ai";
import { z } from "zod";
import { getGatewayModel } from "@/lib/ai/gateway";
import { getElementIntentForVision } from "@/lib/orizon/portal-map";

export const elementLocationSchema = z.object({
  found: z.boolean().describe("True if the target element is visible in the screenshot."),
  selector: z
    .string()
    .optional()
    .describe(
      "Robust CSS selector that uniquely matches the target. Prefer attribute or text-based selectors over deep nth-child paths.",
    ),
  textHint: z
    .string()
    .optional()
    .describe(
      "Short visible text on or near the target element, useful as a fallback locator (5 words max, exact case).",
    ),
  reason: z.string().describe("One-sentence explanation of how the target was identified or why it could not be."),
});

export type ElementLocation = z.infer<typeof elementLocationSchema>;

const visionSystemPrompt =
  "You are a precise web automation assistant for Brazilian medical billing portals. " +
  "Given a webpage screenshot and an intent, identify the single target UI element and return either a robust CSS selector or its short visible text. " +
  "Prefer selectors that match by visible text, role, aria-label, or data-* attributes. " +
  "Never invent selectors that you cannot see in the screenshot. " +
  "If the target is not visible, set found = false and explain in `reason`.";

export type FindElementWithVisionInput =
  | { screenshot: Buffer; intent: string; pageId?: never; elementId?: never }
  | { screenshot: Buffer; pageId: string; elementId: string; intent?: never };

export async function findElementWithVision(input: FindElementWithVisionInput): Promise<ElementLocation> {
  const { intent, pageContext } = resolveIntentAndContext(input);
  const systemMessage = pageContext
    ? `${visionSystemPrompt}\n\nPage context: ${pageContext}`
    : visionSystemPrompt;

  const { object } = await generateObject({
    model: getGatewayModel(),
    schema: elementLocationSchema,
    messages: [
      {
        role: "system",
        content: systemMessage,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Find: ${intent}` },
          { type: "image", image: input.screenshot },
        ],
      },
    ],
  });
  return object;
}

function resolveIntentAndContext(
  input: FindElementWithVisionInput,
): { intent: string; pageContext: string | null } {
  if (typeof input.intent === "string") {
    return { intent: input.intent, pageContext: null };
  }
  if (typeof input.pageId === "string" && typeof input.elementId === "string") {
    const lookup = getElementIntentForVision(input.pageId, input.elementId);
    return { intent: lookup.intent, pageContext: lookup.pageContext };
  }
  throw new Error("findElementWithVision: must provide either {intent} or {pageId, elementId}");
}
