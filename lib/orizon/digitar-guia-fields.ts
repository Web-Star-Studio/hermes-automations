/**
 * TISS-guide → portal-step field mapping for the Fluxo completo
 * (Digitar Guia). Takes a guide summary parsed by `lib/tiss/parser.ts`
 * and emits the fields the adapter should fill on each step of the
 * matching portal form.
 *
 * Only step-1 fields are mapped statically here — the deeper steps'
 * fields aren't deep-walkable upfront because the portal gates step
 * navigation behind validation. The adapter introspects visible
 * inputs at runtime and the vision helper resolves anything unmapped.
 */

import type { TissGuideSummary } from "@/lib/tiss/parser";
import { type GuideTipoId, orizonFaturePortalMap } from "@/lib/orizon/portal-map";

export type StepFieldValues = {
  step: number;
  /** Keyed by element id from the portal map (under guia{Tipo}.elements). */
  values: Record<string, string | number | boolean>;
};

/**
 * Maps a TISS XML guide name (as our parser tags it) to a portal
 * GuideTipoId. Unknown guide names default to consulta.
 */
export function tissGuideNameToTipo(tissGuideName: string): GuideTipoId {
  const types = orizonFaturePortalMap.guideTypes;
  for (const id of Object.keys(types) as GuideTipoId[]) {
    if (types[id].tissGuideName.toLowerCase() === tissGuideName.toLowerCase()) {
      return id;
    }
  }
  return "consulta";
}

/**
 * Builds the per-step field-value plan for filling a guide form.
 * Only step 1 has reliable element-id mappings; deeper steps return
 * an empty `values` map and the adapter falls back to introspection.
 */
export function mapTissGuideToPortalSteps(
  tissGuide: TissGuideSummary,
  tipoId: GuideTipoId,
): StepFieldValues[] {
  const steps: StepFieldValues[] = [];
  steps.push({ step: 1, values: step1Values(tissGuide, tipoId) });
  const stepCount = orizonFaturePortalMap.guideTypes[tipoId].stepCount;
  for (let i = 2; i <= stepCount; i++) {
    steps.push({ step: i, values: {} });
  }
  return steps;
}

function step1Values(
  guide: TissGuideSummary,
  tipoId: GuideTipoId,
): Record<string, string | number | boolean> {
  // Common cabeçalho fields appear in every tipo's step 1.
  const common = {
    nGuiaPrestador: guide.numeroGuiaPrestador ?? "",
    nGuiaOperadora: guide.numeroGuiaOperadora ?? "",
  };

  switch (tipoId) {
    case "consulta":
      return omitEmpty({
        ...common,
        numeroCarteira: guide.numeroCarteira ?? "",
      });
    case "sadt":
      return omitEmpty({
        ...common,
        nGuiaPrincipal: guide.numeroGuiaPrincipal ?? "",
        dataAutorizacao: guide.dataAutorizacao ?? "",
        senha: guide.senhaAutorizacao ?? "",
        dataValidadeSenha: guide.validadeSenha ?? "",
      });
    case "honorario":
      return omitEmpty({
        ...common,
        nGuiaSolicInternacao: guide.numeroGuiaPrincipal ?? "",
        senha: guide.senhaAutorizacao ?? "",
      });
    case "internacao":
      return omitEmpty({
        ...common,
        nGuiaSolicInternacao: guide.numeroGuiaPrincipal ?? "",
        dataAutorizacao: guide.dataAutorizacao ?? "",
        senha: guide.senhaAutorizacao ?? "",
        validadeSenha: guide.validadeSenha ?? "",
      });
    case "odonto":
      return omitEmpty({
        ...common,
        nGuiaPrincipal: guide.numeroGuiaPrincipal ?? "",
        dataAutorizacao: guide.dataAutorizacao ?? "",
        senha: guide.senhaAutorizacao ?? "",
        validadeSenha: guide.validadeSenha ?? "",
      });
  }
}

function omitEmpty<T extends Record<string, string | number | boolean | undefined | null>>(
  obj: T,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}
