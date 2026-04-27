import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTissXml } from "@/lib/tiss/parser";

describe("parseTissXml", () => {
  it("extracts the main fields from a TISS XML document", () => {
    const xml = readFileSync("tests/fixtures/minimal-tiss.xml", "utf8");
    const summary = parseTissXml(xml);

    expect(summary.standardVersion).toBe("4.01.00");
    expect(summary.transactionType).toBe("ENVIO_LOTE_GUIAS");
    expect(summary.providerName).toBe("Clinica Exemplo");
    expect(summary.providerRegister).toBe("98765");
    expect(summary.batchNumber).toBe("12345");
    expect(summary.totalAmount).toBe("150.00");
    expect(summary.beneficiaryNames).toContain("Maria Silva");
  });
});
