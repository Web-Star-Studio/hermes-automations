import { generateObject } from "ai";
import { z } from "zod";
import { getGatewayModel } from "@/lib/ai/gateway";
import { getElementIntentForVision } from "@/lib/orizon/portal-map";
import type { FieldSnapshot } from "@/lib/orizon/runtime-introspection";

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
  actionVerb: z
    .enum(["click", "fill", "select", "check", "scroll"])
    .optional()
    .describe(
      "Suggested action to perform on this element. Override the caller's default verb when the element type makes it appropriate (e.g., a typeahead disguised as <select> needs 'fill' rather than 'select').",
    ),
  reason: z.string().describe("One-sentence explanation of how the target was identified or why it could not be."),
});

export type ElementLocation = z.infer<typeof elementLocationSchema>;

const visionSystemPrompt =
  "You are a precise web automation assistant for Brazilian medical billing portals. " +
  "Given a webpage screenshot and an intent, identify the single target UI element and return either a robust CSS selector or its short visible text. " +
  "Prefer selectors that match by visible text, role, aria-label, or data-* attributes. " +
  "Never invent selectors that you cannot see in the screenshot. " +
  "If the target is not visible, set found = false and explain in `reason`. " +
  "When earlier attempts and their failure outcomes are provided, treat them as constraints: do NOT propose the same selector or strategy that already failed. Use the failure reason to choose a meaningfully different approach (e.g., fall back from id-based to text-based selectors, or suggest a different actionVerb if the element type was misclassified).";

type CommonVisionInput = {
  screenshot: Buffer;
  /**
   * Earlier attempts in the same step's recovery loop. Each entry is a short
   * description of what was tried + why it failed; the model uses these to
   * avoid repeating itself and to switch strategies.
   */
  previousAttempts?: Array<{ approach: string; outcome: string }>;
  /**
   * Optional structured field/button inventory from `snapshotPageFields`. Helps
   * the model when the screenshot alone is ambiguous (e.g., similar-looking
   * dropdowns) by providing exact ng-model paths and select option lists.
   */
  domSnapshot?: FieldSnapshot;
};

export type FindElementWithVisionInput = CommonVisionInput &
  (
    | { intent: string; goal?: never; pageId?: never; elementId?: never }
    | { goal: string; intent?: never; pageId?: string; elementId?: string }
    | { pageId: string; elementId: string; intent?: never; goal?: never }
  );

export async function findElementWithVision(input: FindElementWithVisionInput): Promise<ElementLocation> {
  const { intent, pageContext } = resolveIntentAndContext(input);

  const promptParts: string[] = [visionSystemPrompt];
  if (pageContext) promptParts.push(`Page context: ${pageContext}`);
  if (input.domSnapshot) {
    promptParts.push(
      `Snapshot of visible fields/buttons on the page (truncated):\n${formatSnapshot(input.domSnapshot)}`,
    );
  }

  const userParts: Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }> = [
    { type: "text", text: `Find: ${intent}` },
  ];
  if (input.previousAttempts && input.previousAttempts.length > 0) {
    userParts.push({
      type: "text",
      text:
        "Earlier attempts in this recovery loop and why they failed (do not repeat them):\n" +
        input.previousAttempts
          .map((a, i) => `${i + 1}. ${a.approach} — outcome: ${a.outcome}`)
          .join("\n"),
    });
  }
  userParts.push({ type: "image", image: input.screenshot });

  const { object } = await generateObject({
    model: getGatewayModel(),
    schema: elementLocationSchema,
    messages: [
      { role: "system", content: promptParts.join("\n\n") },
      { role: "user", content: userParts },
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
  if (typeof input.goal === "string") {
    if (typeof input.pageId === "string" && typeof input.elementId === "string") {
      const lookup = getElementIntentForVision(input.pageId, input.elementId);
      // Caller's goal wins, but keep the map's page context as a hint so the
      // model has the title/description text it would have gotten for this
      // page in the deterministic flow.
      return { intent: input.goal, pageContext: lookup.pageContext };
    }
    return { intent: input.goal, pageContext: null };
  }
  if (typeof input.pageId === "string" && typeof input.elementId === "string") {
    const lookup = getElementIntentForVision(input.pageId, input.elementId);
    return { intent: lookup.intent, pageContext: lookup.pageContext };
  }
  throw new Error("findElementWithVision: must provide {intent}, {goal}, or {pageId, elementId}");
}

function formatSnapshot(snapshot: FieldSnapshot): string {
  const lines: string[] = [];
  if (snapshot.headings.length) {
    lines.push(`headings: ${snapshot.headings.slice(0, 6).join(" | ")}`);
  }
  if (snapshot.fields.length) {
    lines.push("fields:");
    for (const f of snapshot.fields.slice(0, 25)) {
      const opts = f.options ? ` options=[${f.options.slice(0, 6).map((o) => o.text).join(", ")}]` : "";
      const value = f.currentValue ? ` value="${f.currentValue.slice(0, 30)}"` : "";
      lines.push(
        `  - ${f.kind} id=${f.id ?? "—"} name=${f.name ?? "—"} label="${f.label.slice(0, 40)}"${value}${opts}`,
      );
    }
  }
  if (snapshot.buttons.length) {
    lines.push("buttons:");
    for (const b of snapshot.buttons.slice(0, 15)) {
      lines.push(`  - id=${b.id ?? "—"} text="${b.text.slice(0, 40)}" ngClick=${b.ngClick ?? "—"}`);
    }
  }
  return lines.join("\n");
}
