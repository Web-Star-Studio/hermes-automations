import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

export type TissProcedureFull = {
  codigo: string;
  descricao: string | null;
  quantidade: string | null;
  valorUnitario: string | null;
  valorTotal: string | null;
  dataExecucao: string | null;
  /** Tabela TUSS / outros (geralmente "22"). */
  codigoTabela: string | null;
};

export type TissGuideSummary = {
  type: string;
  numeroGuiaPrestador: string | null;
  numeroGuiaOperadora: string | null;
  numeroGuiaPrincipal: string | null;
  registroANS: string | null;
  senhaAutorizacao: string | null;
  dataAutorizacao: string | null;
  validadeSenha: string | null;
  beneficiario: string | null;
  numeroCarteira: string | null;
  dataAtendimento: string | null;
  valorTotal: string | null;
  procedureCount: number;
  procedureCodes: string[];
  /** Per-procedure full detail. Empty when the parser couldn't extract procedures. */
  procedures: TissProcedureFull[];
};

export type TissProcedureCode = {
  codigo: string;
  descricao: string | null;
  count: number;
};

export type TissAmountBreakdown = {
  procedimentos: string | null;
  taxasAlugueis: string | null;
  materiais: string | null;
  medicamentos: string | null;
  diarias: string | null;
  gases: string | null;
  total: string | null;
};

export type TissExpanded = {
  competencia: string | null;
  dataEnvioLote: string | null;
  dataInicialFaturamento: string | null;
  dataFinalFaturamento: string | null;
  tipoFaturamento: string | null;
  guideTypes: string[];
  procedureCount: number;
  procedureCodes: TissProcedureCode[];
  amounts: TissAmountBreakdown;
  guides: TissGuideSummary[];
  /** Per-file breakdown when the job has multiple jobFiles. Empty for single-file jobs. */
  files?: Array<{
    fileName: string;
    guideCount: string;
    totalAmount: string | null;
    batchNumber: string | null;
  }>;
};

export type TissSummary = {
  standardVersion: string | null;
  transactionType: string | null;
  providerName: string | null;
  providerRegister: string | null;
  operatorRegister: string | null;
  batchNumber: string | null;
  guideCount: string;
  totalAmount: string | null;
  beneficiaryNames: string[];
  rawSummary: Record<string, unknown> & { expanded?: TissExpanded };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

const guideTagNames = [
  "guiaSP-SADT",
  "guiaSPSADT",
  "guiaConsulta",
  "guiaResumoInternacao",
  "guiaHonorarios",
  "guiaOdontologica",
  "guiaOPME",
];

const procedureTagNames = ["procedimentoExecutado", "procedimento", "procedimentos"];

export function extractXmlDocuments(fileName: string, bytes: Buffer): Array<{ name: string; xml: string }> {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".xml") {
    return [{ name: fileName, xml: bytes.toString("utf8") }];
  }

  if (extension !== ".zip") {
    throw new Error("Arquivo precisa ser XML ou ZIP.");
  }

  const entries = unzipSync(bytes);
  const xmlDocuments = Object.entries(entries)
    .filter(([name]) => {
      const normalized = name.replaceAll("\\", "/");
      return (
        normalized.endsWith(".xml") &&
        !normalized.includes("../") &&
        !normalized.startsWith("/")
      );
    })
    .slice(0, 20)
    .map(([name, content]) => ({ name, xml: Buffer.from(content).toString("utf8") }));

  if (xmlDocuments.length === 0) {
    throw new Error("ZIP nao contem XML TISS valido.");
  }

  return xmlDocuments;
}

export function parseTissXml(xml: string): TissSummary {
  const parsed = parser.parse(xml);
  const values = collectValues(parsed);

  const beneficiaryNames = uniq(
    findMany(values, ["nomeBeneficiario", "beneficiario.nome", "dadosBeneficiario.nomeBeneficiario"]),
  );

  const guideNodes = findGuideNodes(parsed);
  const guides = guideNodes.map(summarizeGuide);
  const guideCount = guides.length || countKeys(values, guideTagNames) || 1;

  const procedureCodes = aggregateProcedures(guides);
  const procedureCount = guides.reduce((acc, guide) => acc + guide.procedureCount, 0);

  const expanded: TissExpanded = {
    competencia: findFirst(values, ["competenciaLote", "competencia"]) ?? deriveCompetencia(guides),
    dataEnvioLote: findFirst(values, ["dataEnvioLote", "dataRegistroTransacao"]) ?? null,
    dataInicialFaturamento:
      findFirst(values, ["dataInicialFaturamento", "dataInicioFaturamento"]) ??
      minDate(guides.map((g) => g.dataAtendimento)),
    dataFinalFaturamento:
      findFirst(values, ["dataFinalFaturamento", "dataFimFaturamento"]) ??
      maxDate(guides.map((g) => g.dataAtendimento)),
    tipoFaturamento: humanizeTransaction(
      findFirst(values, ["tipoTransacao", "identificacaoTransacao.tipoTransacao"]),
    ),
    guideTypes: uniq(guides.map((g) => g.type)),
    procedureCount,
    procedureCodes: procedureCodes.slice(0, 15),
    amounts: {
      procedimentos: findFirst(values, ["valorTotalProcedimentos"]),
      taxasAlugueis: findFirst(values, ["valorTotalTaxasAlugueis", "valorTaxasAlugueis"]),
      materiais: findFirst(values, ["valorTotalMateriais", "valorMateriais"]),
      medicamentos: findFirst(values, ["valorTotalMedicamentos", "valorMedicamentos"]),
      diarias: findFirst(values, ["valorTotalDiarias", "valorDiarias"]),
      gases: findFirst(values, ["valorTotalGasesMedicinais", "valorGasesMedicinais"]),
      total:
        findFirst(values, ["valorTotalGeral", "valorTotal", "valorProcessado", "valorInformado"]) ??
        null,
    },
    guides: guides.slice(0, 20),
  };

  const totalAmount = expanded.amounts.total;

  return {
    standardVersion: findFirst(values, ["Padrao", "versaoPadrao", "versao"]) ?? null,
    transactionType:
      findFirst(values, ["tipoTransacao", "identificacaoTransacao.tipoTransacao"]) ?? null,
    providerName:
      findFirst(values, ["nomeContratado", "contratado.nomeContratado", "nomePrestador"]) ?? null,
    providerRegister:
      findFirst(values, ["codigoPrestadorNaOperadora", "codigoPrestador"]) ?? null,
    operatorRegister: findFirst(values, ["registroANS", "ansRegistro"]) ?? null,
    batchNumber: findFirst(values, ["numeroLote", "lote.numeroLote"]) ?? null,
    guideCount: String(guideCount),
    totalAmount,
    beneficiaryNames: beneficiaryNames.slice(0, 30),
    rawSummary: {
      rootKeys: Object.keys(parsed ?? {}).slice(0, 12),
      expanded,
    },
  };
}

function collectValues(input: unknown, prefix = "", output: Record<string, unknown> = {}) {
  if (Array.isArray(input)) {
    output[prefix] = input.length;
    input.forEach((item, index) => collectValues(item, `${prefix}[${index}]`, output));
    return output;
  }

  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectValues(value, nextPrefix, output);
      output[key] ??= value;
    }
    return output;
  }

  if (prefix) {
    output[prefix] = input;
  }

  return output;
}

function findFirst(values: Record<string, unknown>, candidates: string[]) {
  for (const candidate of candidates) {
    const direct = values[candidate];
    if (typeof direct === "string" || typeof direct === "number") {
      return String(direct);
    }

    const fuzzy = Object.entries(values).find(
      ([key, value]) => key.endsWith(`.${candidate}`) && isScalar(value),
    );

    if (fuzzy) {
      return String(fuzzy[1]);
    }
  }

  return null;
}

function findMany(values: Record<string, unknown>, candidates: string[]) {
  return Object.entries(values)
    .filter(([key, value]) => candidates.some((candidate) => key.endsWith(candidate)) && isScalar(value))
    .map(([, value]) => String(value));
}

function countKeys(values: Record<string, unknown>, candidates: string[]) {
  return Object.keys(values).filter((key) => candidates.some((candidate) => key.includes(candidate)))
    .length;
}

function isScalar(value: unknown) {
  return typeof value === "string" || typeof value === "number";
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function findGuideNodes(input: unknown): Array<{ type: string; node: Record<string, unknown> }> {
  const out: Array<{ type: string; node: Record<string, unknown> }> = [];
  walk(input);
  return out;

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (guideTagNames.some((tag) => key.toLowerCase() === tag.toLowerCase())) {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") {
              out.push({ type: key, node: item as Record<string, unknown> });
            }
          }
        } else if (child && typeof child === "object") {
          out.push({ type: key, node: child as Record<string, unknown> });
        }
      }
      walk(child);
    }
  }
}

function summarizeGuide(entry: { type: string; node: Record<string, unknown> }): TissGuideSummary {
  const guideValues = collectValues(entry.node);
  const procedures = collectProcedures(entry.node);

  return {
    type: entry.type,
    numeroGuiaPrestador: findFirst(guideValues, ["numeroGuiaPrestador"]),
    numeroGuiaOperadora: findFirst(guideValues, [
      "numeroGuiaOperadora",
      "numeroGuiaAtribuidoOperadora",
    ]),
    numeroGuiaPrincipal: findFirst(guideValues, ["numeroGuiaPrincipal"]),
    registroANS: findFirst(guideValues, ["registroANS", "ansRegistro"]),
    senhaAutorizacao: findFirst(guideValues, ["senha", "senhaField"]),
    dataAutorizacao: findFirst(guideValues, ["dataAutorizacao"]),
    validadeSenha: findFirst(guideValues, ["dataValidadeSenha", "validadeSenha"]),
    beneficiario:
      findFirst(guideValues, [
        "nomeBeneficiario",
        "dadosBeneficiario.nomeBeneficiario",
        "beneficiario.nome",
      ]) ?? null,
    numeroCarteira:
      findFirst(guideValues, [
        "numeroCarteira",
        "dadosBeneficiario.numeroCarteira",
        "carteira",
      ]) ?? null,
    dataAtendimento:
      findFirst(guideValues, [
        "dataAtendimento",
        "dataExecucao",
        "dataInicioFaturamento",
        "dataInicioInternacao",
      ]) ?? null,
    valorTotal:
      findFirst(guideValues, [
        "valorTotalGeral",
        "valorTotal",
        "valorTotalProcedimentos",
      ]) ?? null,
    procedureCount: procedures.length,
    procedureCodes: uniq(procedures.map((p) => p.codigo)).slice(0, 6),
    procedures: procedures.slice(0, 30),
  };
}

function collectProcedures(input: unknown): TissProcedureFull[] {
  const out: TissProcedureFull[] = [];
  walk(input);
  return out;

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (procedureTagNames.some((tag) => key.toLowerCase() === tag.toLowerCase())) {
        const items = Array.isArray(child) ? child : [child];
        for (const item of items) {
          if (item && typeof item === "object") {
            const procValues = collectValues(item);
            const codigo = findFirst(procValues, ["codigoProcedimento", "codigo"]);
            if (!codigo) continue;
            out.push({
              codigo,
              descricao: findFirst(procValues, ["descricaoProcedimento", "descricao"]),
              quantidade: findFirst(procValues, [
                "quantidadeExecutada",
                "quantidadeAutorizada",
                "quantidadeSolicitada",
                "qtdExecutada",
                "quantidade",
              ]),
              valorUnitario: findFirst(procValues, [
                "valorUnitario",
                "valor",
              ]),
              valorTotal: findFirst(procValues, [
                "valorTotalProcedimento",
                "valorTotal",
              ]),
              dataExecucao: findFirst(procValues, [
                "dataExecucao",
                "dataExecucaoProcedimento",
                "dataAtendimento",
              ]),
              codigoTabela: findFirst(procValues, ["codigoTabela", "tabela"]),
            });
          }
        }
      }
      walk(child);
    }
  }
}

function aggregateProcedures(guides: TissGuideSummary[]): TissProcedureCode[] {
  const counts = new Map<string, number>();
  for (const guide of guides) {
    for (const code of guide.procedureCodes) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([codigo, count]) => ({ codigo, count, descricao: null }));
}

function humanizeTransaction(value: string | null): string | null {
  if (!value) return null;
  const map: Record<string, string> = {
    ENVIO_LOTE_GUIAS: "Envio de lote de guias",
    ENVIO_LOTE: "Envio de lote",
    ANEXO_CLINICO: "Anexo clínico",
  };
  return map[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function deriveCompetencia(guides: TissGuideSummary[]): string | null {
  const dates = guides
    .map((g) => g.dataAtendimento)
    .filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  const ymd = dates.sort()[0];
  if (!/^\d{4}-\d{2}/.test(ymd)) return null;
  const [year, month] = ymd.split("-");
  return `${month}/${year}`;
}

function minDate(values: Array<string | null>): string | null {
  const valid = values.filter((v): v is string => !!v).sort();
  return valid[0] ?? null;
}

function maxDate(values: Array<string | null>): string | null {
  const valid = values.filter((v): v is string => !!v).sort();
  return valid[valid.length - 1] ?? null;
}
