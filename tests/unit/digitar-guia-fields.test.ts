import { describe, expect, it } from "vitest";
import {
  mapTissGuideToPortalSteps,
  tissGuideNameToTipo,
} from "@/lib/orizon/digitar-guia-fields";
import { orizonFaturePortalMap, type GuideTipoId } from "@/lib/orizon/portal-map";
import type { TissGuideSummary } from "@/lib/tiss/parser";

const baseGuide: TissGuideSummary = {
  type: "guiaConsulta",
  numeroGuiaPrestador: "12345",
  numeroGuiaOperadora: "67890",
  numeroGuiaPrincipal: null,
  registroANS: "5711",
  senhaAutorizacao: null,
  dataAutorizacao: null,
  validadeSenha: null,
  beneficiario: "FULANO DE TAL",
  numeroCarteira: "9988776655",
  dataAtendimento: "2026-04-15",
  valorTotal: "150.00",
  procedureCount: 1,
  procedureCodes: ["10101012"],
  procedures: [
    {
      codigo: "10101012",
      descricao: "Consulta",
      quantidade: "1",
      valorUnitario: "150.00",
      valorTotal: "150.00",
      dataExecucao: "2026-04-15",
      codigoTabela: "22",
    },
  ],
};

describe("tissGuideNameToTipo", () => {
  it("maps known TISS guide tag names to GuideTipoId", () => {
    expect(tissGuideNameToTipo("guiaConsulta")).toBe("consulta");
    expect(tissGuideNameToTipo("guiaSP-SADT")).toBe("sadt");
    expect(tissGuideNameToTipo("guiaHonorarios")).toBe("honorario");
    expect(tissGuideNameToTipo("guiaResumoInternacao")).toBe("internacao");
    expect(tissGuideNameToTipo("guiaOdontologica")).toBe("odonto");
  });

  it("falls back to consulta for unknown names", () => {
    expect(tissGuideNameToTipo("guiaQualquerCoisa")).toBe("consulta");
  });

  it("is case-insensitive", () => {
    expect(tissGuideNameToTipo("GUIAconsulta")).toBe("consulta");
  });
});

describe("mapTissGuideToPortalSteps", () => {
  it("returns the right number of step slots per tipo", () => {
    for (const id of Object.keys(orizonFaturePortalMap.guideTypes) as GuideTipoId[]) {
      const steps = mapTissGuideToPortalSteps(baseGuide, id);
      expect(steps.length).toBe(orizonFaturePortalMap.guideTypes[id].stepCount);
    }
  });

  it("includes the prestador / operadora numbers in step 1", () => {
    const steps = mapTissGuideToPortalSteps(baseGuide, "consulta");
    expect(steps[0].step).toBe(1);
    expect(steps[0].values.nGuiaPrestador).toBe("12345");
    expect(steps[0].values.nGuiaOperadora).toBe("67890");
    expect(steps[0].values.numeroCarteira).toBe("9988776655");
  });

  it("omits empty fields", () => {
    const sparseGuide: TissGuideSummary = {
      ...baseGuide,
      numeroCarteira: null,
      numeroGuiaOperadora: null,
    };
    const steps = mapTissGuideToPortalSteps(sparseGuide, "consulta");
    expect(steps[0].values.numeroCarteira).toBeUndefined();
    expect(steps[0].values.nGuiaOperadora).toBeUndefined();
    expect(steps[0].values.nGuiaPrestador).toBe("12345");
  });

  it("returns empty values for steps 2..N (runtime introspection)", () => {
    const steps = mapTissGuideToPortalSteps(baseGuide, "internacao");
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].values).toEqual({});
    }
  });
});
