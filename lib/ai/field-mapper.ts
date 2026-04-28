import { generateObject } from "ai";
import { z } from "zod";
import { getGatewayModel } from "@/lib/ai/gateway";
import type { FieldSnapshot } from "@/lib/orizon/runtime-introspection";

/**
 * Vision/LLM-driven mapping of structured TISS data onto a runtime
 * snapshot of an unknown form. Used as a fallback when the static portal
 * map doesn't cover all the fields on the current step (e.g., deep steps
 * of guides whose later steps the portal blocks us from walking
 * statically) or for ad-hoc modals like the procedure-add form.
 *
 * Privacy: we send the snapshot's *structure* (ids, labels, placeholders)
 * plus the TISS data values to the model. We do NOT send screenshots in
 * this helper — text-only context is enough for form-field reasoning and
 * cheaper than the locator vision helper.
 */

const fieldAssignmentSchema = z.object({
  /** id or cssPath from the snapshot — must match exactly. */
  fieldKey: z.string().describe("The 'id' (preferred) or 'cssPath' from the snapshot identifying the target field."),
  /** For selects, the option value (NOT label) when known. */
  value: z.string().describe("The value to fill. For selects, prefer matching an option's `value`; otherwise the option's text."),
  reason: z.string().describe("Brief justification (max 1 sentence)."),
});

const mappingSchema = z.object({
  assignments: z.array(fieldAssignmentSchema),
  unmapped: z.array(z.string()).describe("Snapshot field keys that intentionally have no value (no matching TISS data)."),
});

export type FieldAssignment = z.infer<typeof fieldAssignmentSchema>;
export type MappingResult = z.infer<typeof mappingSchema>;

const systemPrompt =
  "You are a precise web-form filler for Brazilian medical billing portals (Orizon Fature). " +
  "You will receive a snapshot of visible form fields plus a JSON object with TISS data values. " +
  "Return assignments mapping snapshot fieldKeys (prefer `id`, otherwise `cssPath`) to values. " +
  "For SELECT fields, choose the option value (or text) that semantically matches the TISS value — never invent options that aren't listed. " +
  "Only assign fields you can confidently infer. List the rest in `unmapped`. " +
  "Never assign disabled or pre-filled fields unless the existing value is clearly wrong.";

export type MapTissToFieldsInput = {
  snapshot: FieldSnapshot;
  /** Arbitrary structured TISS data — guide summary, beneficiary data, etc. */
  tissData: Record<string, unknown>;
  /** Page context (e.g. 'Guia Internação - etapa 3 - Dados do beneficiário'). */
  pageContext: string;
};

export async function mapTissToFields(input: MapTissToFieldsInput): Promise<MappingResult> {
  // Drop disabled fields (we won't fill them anyway) to keep the prompt tight.
  const usableFields = input.snapshot.fields.filter((f) => !f.disabled);
  const compactSnapshot = {
    url: input.snapshot.url,
    headings: input.snapshot.headings,
    fields: usableFields.map((f) => ({
      key: f.id ?? f.cssPath,
      kind: f.kind,
      label: f.label,
      placeholder: f.placeholder,
      ngModel: f.ngModel,
      required: f.required,
      currentValue: f.currentValue,
      options: f.options?.slice(0, 30) ?? null,
    })),
  };

  const { object } = await generateObject({
    model: getGatewayModel(),
    schema: mappingSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Page context: ${input.pageContext}` },
          {
            type: "text",
            text: `Form snapshot:\n${JSON.stringify(compactSnapshot, null, 2)}`,
          },
          {
            type: "text",
            text: `TISS data to fill from:\n${JSON.stringify(input.tissData, null, 2)}`,
          },
        ],
      },
    ],
  });

  return object;
}
