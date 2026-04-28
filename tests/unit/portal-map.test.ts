import { describe, expect, it } from "vitest";
import {
  buildGuiaUrl,
  describePortalForPrompt,
  getElement,
  getElementIntentForVision,
  getModal,
  orizonFaturePortalMap,
} from "@/lib/orizon/portal-map";

describe("orizonFaturePortalMap", () => {
  it("registers every page used by both flows", () => {
    for (const flow of Object.values(orizonFaturePortalMap.flows)) {
      for (const step of flow.steps) {
        expect(orizonFaturePortalMap.pages[step.pageId]).toBeDefined();
        if (step.elementId) {
          expect(() => getElement(step.pageId, step.elementId!)).not.toThrow();
        }
        if (step.modalId) {
          expect(() => getModal(step.modalId!)).not.toThrow();
        }
      }
    }
  });

  it("exposes the four required modals", () => {
    expect(orizonFaturePortalMap.modals.cookieBanner).toBeDefined();
    expect(orizonFaturePortalMap.modals.comunicadoInicial).toBeDefined();
    expect(orizonFaturePortalMap.modals.supportTerms).toBeDefined();
    expect(orizonFaturePortalMap.modals.tourOverlay).toBeDefined();
  });

  it("flags the comunicadoInicial modal as scroll+JS-click", () => {
    expect(orizonFaturePortalMap.modals.comunicadoInicial.requiresScrollAndJsClick).toBe(true);
  });

  it("registers all five guide types with verified URL paths", () => {
    const guideTypes = orizonFaturePortalMap.guideTypes;
    expect(guideTypes.consulta.urlPath).toBe("guia_consulta");
    expect(guideTypes.sadt.urlPath).toBe("guia_sadt");
    expect(guideTypes.honorario.urlPath).toBe("guia_honorario");
    expect(guideTypes.internacao.urlPath).toBe("guia_internacao");
    expect(guideTypes.odonto.urlPath).toBe("guia_odonto");
  });

  it("step counts match what we observed live", () => {
    const guideTypes = orizonFaturePortalMap.guideTypes;
    expect(guideTypes.consulta.stepCount).toBe(3);
    expect(guideTypes.sadt.stepCount).toBe(5);
    expect(guideTypes.honorario.stepCount).toBe(5);
    expect(guideTypes.internacao.stepCount).toBe(7);
    expect(guideTypes.odonto.stepCount).toBe(6);
  });

  it("getElementIntentForVision returns intent + page context", () => {
    const v = getElementIntentForVision("uploadTiss", "selectAllCheckbox");
    expect(v.intent).toMatch(/select-all|column-header/);
    expect(v.pageContext).toContain("Enviar XML TISS");
  });

  it("getElement throws on unknown ids", () => {
    expect(() => getElement("uploadTiss", "doesNotExist")).toThrow();
    expect(() => getElement("doesNotExist", "anything")).toThrow();
  });

  it("describePortalForPrompt mentions every page id", () => {
    const text = describePortalForPrompt();
    for (const id of Object.keys(orizonFaturePortalMap.pages)) {
      expect(text).toContain(id);
    }
  });

  it("describePortalForPrompt mentions both flows", () => {
    const text = describePortalForPrompt();
    expect(text).toContain("Fluxo curto");
    expect(text).toContain("Fluxo completo");
  });
});

describe("buildGuiaUrl", () => {
  it("constructs the deep-link URL for a Consulta guide", () => {
    const url = buildGuiaUrl("consulta", {
      idOperadora: 48,
      idPrestador: 186870,
      ans: 5711,
    });
    expect(url).toContain("/guia_consulta/");
    expect(url).toContain("IDOperadora=48");
    expect(url).toContain("IDPrestador=186870");
    expect(url).toContain("TipoGuia=1");
    expect(url).toContain("reg_ans=5711");
    expect(url).toContain("ReadOnly=True");
    expect(url).toContain("Versao=4.02.00");
  });

  it("respects readOnly=false", () => {
    const url = buildGuiaUrl("internacao", {
      idOperadora: 48,
      idPrestador: 186870,
      ans: 5711,
      readOnly: false,
    });
    expect(url).toContain("ReadOnly=False");
    expect(url).toContain("TipoGuia=4");
  });
});
