import type { Locator, Page } from "playwright-core";

/**
 * Portal map — single source of truth for the Orizon Fature web portal.
 * Selectors below were captured against the live portal with verified
 * stable IDs / ng-models / ARIA roles. The adapter, the agent system
 * prompt, and the vision-recovery helper all read from this module.
 */

export type SelectorCandidate =
  | { kind: "role"; type: "link" | "button" | "checkbox" | "textbox" | "combobox"; name?: RegExp }
  | { kind: "id"; id: string }
  | { kind: "css"; selector: string }
  | { kind: "text"; pattern: RegExp; exact?: boolean }
  | { kind: "ngModel"; value: string };

export type PortalElement = {
  id: string;
  /** pt-BR description used in the agent prompt. */
  description: string;
  /** English description used as the vision intent. */
  intent: string;
  candidates: SelectorCandidate[];
};

export type PortalModal = {
  id: string;
  description: string;
  detect: SelectorCandidate;
  primaryAction: PortalElement;
  /**
   * When true, primaryAction must be scrollIntoView'd before click and
   * clicked via JS .click() — Playwright's hit-testing fails when the
   * action is far below the viewport (e.g. comunicadoInicial).
   */
  requiresScrollAndJsClick?: boolean;
};

export type PortalPage = {
  id: string;
  title: string;
  description: string;
  url?: string | RegExp;
  elements: Record<string, PortalElement>;
  optionalModals?: string[];
};

export type PortalFlowStep = {
  pageId: string;
  action: string;
  elementId?: string;
  modalId?: string;
};

export type PortalFlow = {
  id: "short" | "complete";
  label: string;
  steps: PortalFlowStep[];
};

export type GuideTipoId = "consulta" | "sadt" | "honorario" | "internacao" | "odonto";

export type GuideTypeMeta = {
  label: string;
  /** Value of the #tipoDeGuia option (e.g., "number:1"). */
  selectValue: string;
  /** Hash path under #/{urlPath}/. */
  urlPath: string;
  /** Page id in this map. */
  pageId: string;
  /** Common ng-model prefix (e.g., "guiaConsulta.Guia"). */
  ngModelPrefix: string;
  stepCount: number;
  /** Matches the tag name used by our TISS parser's findGuideNodes. */
  tissGuideName: string;
  /** Per-tipo "advance to step N" button id. */
  nextStepButtonId: (step: number) => string;
};

export type PortalMap = {
  pages: Record<string, PortalPage>;
  modals: Record<string, PortalModal>;
  flows: Record<"short" | "complete", PortalFlow>;
  guideTypes: Record<GuideTipoId, GuideTypeMeta>;
};

const ssoLoginUrl =
  "https://sso-fature.orizon.com.br/auth/realms/orizon-dativa/protocol/openid-connect/auth?client_id=fature_client&response_type=code&scope=openid&redirect_uri=https://sso-auth-codeflow-fature-apicast-production.api.ocppr.orizon.com.br/sso/token?user_key=32efd36b405a07b8c0e6c6cb9c582047";

// ─── Modals ───────────────────────────────────────────────────────────

const cookieBanner: PortalModal = {
  id: "cookieBanner",
  description: "Banner LGPD de consentimento de cookies.",
  detect: { kind: "text", pattern: /permitir todos os cookies/i },
  primaryAction: {
    id: "permitirTodos",
    description: "Botão 'Permitir todos os Cookies' para aceitar o banner LGPD.",
    intent: "the 'Permitir todos os Cookies' button on the LGPD cookie consent banner (NOT 'Rejeitar Cookies não necessários', NOT 'Preferências de cookies')",
    candidates: [
      { kind: "role", type: "button", name: /permitir todos os cookies/i },
      { kind: "css", selector: 'button:has-text("Permitir todos os Cookies")' },
      { kind: "css", selector: 'button:has-text("Permitir todos")' },
    ],
  },
};

const comunicadoInicial: PortalModal = {
  id: "comunicadoInicial",
  description: "Modal 'Comunicado' que abre na primeira visita ao dashboard.",
  detect: { kind: "id", id: "mensagemInicialModalPrestador" },
  primaryAction: {
    id: "fecharComunicado",
    description: "Botão 'Fechar' do modal Comunicado inicial. Fica no fim de um modal longo — precisa scroll antes do clique.",
    intent: "the 'Fechar' button at the bottom of the long 'Comunicado' modal that appears on first dashboard load",
    candidates: [
      { kind: "id", id: "botaoMensagemInicialModalPrestador" },
      { kind: "css", selector: '#mensagemInicialModalPrestador button.btn-primary' },
    ],
  },
  requiresScrollAndJsClick: true,
};

const supportTerms: PortalModal = {
  id: "supportTerms",
  description: "Termo de Suporte — checkbox 'Li e Concordo' habilitado após scroll do termo.",
  detect: { kind: "id", id: "Li_Concordo_Suporte" },
  primaryAction: {
    id: "concordarTermo",
    description: "Checkbox 'Li e Concordo' do termo de suporte (habilitado após scroll-to-end).",
    intent: "the 'Li e Concordo' checkbox of the Support Terms modal — enabled only after the modal body is scrolled to the end",
    candidates: [
      { kind: "id", id: "Li_Concordo_Suporte" },
      { kind: "ngModel", value: "Li_Concordo_Suporte" },
    ],
  },
};

const tourOverlay: PortalModal = {
  id: "tourOverlay",
  description: "Overlay de tour guiado (Hopscotch-style) que aparece no Digitar Guia e nas guias.",
  detect: { kind: "css", selector: '[class*="tour-"][class*="-element"]' },
  primaryAction: {
    id: "terminarTour",
    description: "Botão 'Terminar' que dispensa o overlay de tour.",
    intent: "the 'Terminar' button on the small Hopscotch-style guided-tour overlay that wraps a sidebar/menu element",
    candidates: [
      { kind: "css", selector: 'button.btn-sm.btn-default:has-text("Terminar")' },
      { kind: "text", pattern: /^terminar$/i, exact: false },
    ],
  },
};

const lotesEnviadosSucesso: PortalModal = {
  id: "lotesEnviadosSucesso",
  description: "Modal de confirmação que aparece após 'Enviar arquivos válidos' — título 'Lotes enviados com sucesso!'.",
  detect: { kind: "text", pattern: /lotes enviados com sucesso/i },
  primaryAction: {
    id: "enviarMaisLotes",
    description: "Botão 'Enviar mais lotes' do modal de sucesso (volta para a tela de envio limpa).",
    intent: "the 'Enviar mais lotes' button inside the 'Lotes enviados com sucesso!' success modal (NOT 'Ir para Lista de Lotes', which is the alternative blue button)",
    candidates: [
      { kind: "role", type: "button", name: /^enviar mais lotes$/i },
      { kind: "css", selector: 'button:has-text("Enviar mais lotes")' },
    ],
  },
};

// ─── Pages ────────────────────────────────────────────────────────────

const solutionsSelector: PortalPage = {
  id: "solutionsSelector",
  title: "Seletor de soluções Orizon",
  description: "Página de entrada com 6 colunas (Autorize / FATURE / Autorize Farma / Affinity / Administração Farma / BPO).",
  url: /orizon\.com\.br\/acesso-restrito\.html/,
  elements: {
    fatureLogin: {
      id: "fatureLogin",
      description: "Botão 'Efetuar login' da coluna FATURE.",
      intent: "the 'Efetuar login' button under the FATURE column on the Orizon solutions selector page (NOT under AUTORIZE / AUTORIZE FARMA / AFFINITY / ADMINISTRAÇÃO FARMA / BPO)",
      candidates: [
        { kind: "css", selector: 'button.btn-efetuar-login[value="FATURE"]' },
        { kind: "css", selector: 'button[name="Faturi"][value="FATURE"]' },
      ],
    },
  },
  optionalModals: ["cookieBanner"],
};

const ssoLogin: PortalPage = {
  id: "ssoLogin",
  title: "Login SSO Fature (Keycloak)",
  description: "Tela de autenticação Keycloak. Submit é assíncrono — primeira tentativa pode ficar parada, pode ser necessário re-clicar.",
  url: /sso-fature\.orizon\.com\.br/,
  elements: {
    username: {
      id: "username",
      description: "Campo Usuário do login Fature.",
      intent: "the username input on the Fature SSO login page",
      candidates: [
        { kind: "id", id: "username" },
        { kind: "css", selector: 'input[name="username"]' },
        { kind: "role", type: "textbox", name: /usu[áa]rio/i },
      ],
    },
    password: {
      id: "password",
      description: "Campo Senha do login Fature.",
      intent: "the password input on the Fature SSO login page",
      candidates: [
        { kind: "id", id: "password" },
        { kind: "css", selector: 'input[name="password"]' },
        { kind: "role", type: "textbox", name: /senha/i },
      ],
    },
    submit: {
      id: "submit",
      description: "Botão Acessar do login Fature.",
      intent: "the 'Acessar' submit button on the Fature SSO login page",
      candidates: [
        { kind: "id", id: "kc-login" },
        { kind: "role", type: "button", name: /^acessar$/i },
      ],
    },
  },
  optionalModals: ["cookieBanner"],
};

const dashboard: PortalPage = {
  id: "dashboard",
  title: "Dashboard Fature",
  description: "Página inicial pós-login. Tem sidebar (Home / Enviar XML TISS / Digitar / Lotes Rápidos / Consultar / Cadastrar / Criar Remessa) e tiles centrais (Digitar Guias / Lista de Guias / Utilizar Modelos / Lista de Lotes).",
  url: /portal\.orizon\.com\.br\/fature\/.*#\/dashboard/,
  elements: {
    enviarXmlTissSidebar: {
      id: "enviarXmlTissSidebar",
      description: "Item 'Enviar XML TISS' na sidebar (entrada do fluxo curto).",
      intent: "the 'Enviar XML TISS' link in the left sidebar of the Fature dashboard",
      candidates: [
        { kind: "id", id: "linkMenuEnviarXMLTISS" },
        { kind: "css", selector: 'a[href="#arquivo_tiss"]' },
      ],
    },
    digitarGuiasTile: {
      id: "digitarGuiasTile",
      description: "Tile/cartão 'Digitar Guias' no corpo do dashboard (entrada do fluxo completo).",
      intent: "the 'Digitar Guias' tile/card on the Fature dashboard body — large clickable card with an icon, NOT the sidebar 'Digitar' submenu trigger",
      candidates: [
        { kind: "id", id: "linkDigitarGuias" },
        { kind: "css", selector: 'a.task[href="#digitar_guia/"]' },
      ],
    },
    home: {
      id: "home",
      description: "Item Home da sidebar.",
      intent: "the Home link in the sidebar",
      candidates: [{ kind: "id", id: "linkMenuHome" }],
    },
  },
  optionalModals: ["comunicadoInicial"],
};

const uploadTiss: PortalPage = {
  id: "uploadTiss",
  title: "Enviar XML TISS",
  description: "Página de upload de lote TISS (.zip). Após selecionar arquivo aparecem checkbox de termo de suporte, lista de lotes e botões Enviar/Excluir.",
  url: /#\/arquivo_tiss/,
  elements: {
    fileInput: {
      id: "fileInput",
      description: "Input de arquivo para upload do ZIP TISS.",
      intent: "the hidden file input on the Enviar XML TISS page (accepts .zip)",
      candidates: [
        { kind: "id", id: "ngf-inputFiles" },
        { kind: "css", selector: 'input[name="inputFiles"][type="file"]' },
        { kind: "css", selector: 'input[type="file"][accept=".zip"]' },
      ],
    },
    selectAllCheckbox: {
      id: "selectAllCheckbox",
      description: "Checkbox de cabeçalho 'selecionar todos os lotes' (aparece após upload).",
      intent: "the column-header (select-all) checkbox at the top of the uploaded batches list — class ckbExcluirTodosArquivo, only visible once a file is in the list, NOT any hidden modal checkbox like Li_Concordo_Suporte",
      candidates: [
        { kind: "css", selector: 'input.ckbExcluirTodosArquivo' },
        { kind: "css", selector: 'input[type="checkbox"]:not([disabled]):visible' },
      ],
    },
    enviarButton: {
      id: "enviarButton",
      description: "Botão laranja 'Enviar' que abre modal de confirmação.",
      intent: "the orange 'Enviar' button at the bottom of the upload form (NOT 'Enviar XML TISS' in the sidebar, NOT 'Enviar arquivos válidos' in any modal, NOT 'Excluir selecionados' which is gray)",
      candidates: [
        { kind: "css", selector: '#botaoAssinarEnviar.orange' },
        { kind: "css", selector: 'button.orange:has-text("Enviar"):not(:has-text("arquivos")):not(:has-text("XML"))' },
      ],
    },
    enviarMaisLotes: {
      id: "enviarMaisLotes",
      description: "Botão 'Enviar mais lotes' (após primeiro envio).",
      intent: "the 'Enviar mais lotes' button shown after a successful submission",
      candidates: [{ kind: "id", id: "botaoEnviarMais" }],
    },
  },
  optionalModals: ["supportTerms"],
};

const confirmBatchesModal: PortalPage = {
  id: "confirmBatchesModal",
  title: "Modal Confirmar dados dos lotes",
  description: "Modal pop-up após clicar Enviar — confirma os lotes a enviar e tem botões Voltar / Enviar arquivos válidos / Exportar erros dos arquivos.",
  elements: {
    enviarValidosButton: {
      id: "enviarValidosButton",
      description: "Botão 'Enviar arquivos válidos' do modal de confirmação.",
      intent: "the orange 'Enviar arquivos válidos' button inside the 'Confirmar dados dos lotes' modal",
      candidates: [
        { kind: "role", type: "button", name: /enviar arquivos v[aá]lidos/i },
        { kind: "css", selector: 'button:has-text("Enviar arquivos válidos")' },
        { kind: "css", selector: 'button:has-text("Enviar arquivos validos")' },
      ],
    },
  },
};

const digitarGuia: PortalPage = {
  id: "digitarGuia",
  title: "Digitar Guia",
  description: "Formulário de seleção (Operadora + Tipo de Guia) que abre uma das 5 sub-páginas de guia.",
  url: /#\/digitar_guia/,
  elements: {
    operadoraSelect: {
      id: "operadoraSelect",
      description: "Select Operadora* — valores no formato 'IDOperadora:ANS' (ex: 48:5711 para Bradesco S/A).",
      intent: "the Operadora select dropdown on the Digitar Guia page",
      candidates: [
        { kind: "id", id: "operadora" },
        { kind: "ngModel", value: "operadoraSelecionada" },
      ],
    },
    tipoGuiaSelect: {
      id: "tipoGuiaSelect",
      description: "Select Tipo de Guia* — valores 'number:1' Consulta / 'number:2' SP_SADT / 'number:3' Honorário / 'number:4' Internação / 'number:5' Odontologia.",
      intent: "the 'Tipo de Guia' select dropdown on the Digitar Guia page",
      candidates: [
        { kind: "id", id: "tipoDeGuia" },
        { kind: "ngModel", value: "tipoGuia" },
      ],
    },
    submitButton: {
      id: "submitButton",
      description: "Botão laranja 'Digitar Guia' — chama iniciarDigitacao() e roteia para a sub-página de guia.",
      intent: "the orange 'Digitar Guia' submit button that routes to the per-tipo guide form",
      candidates: [
        { kind: "id", id: "botaoDigitarGuia" },
        { kind: "css", selector: 'button.orange:has-text("Digitar Guia")' },
      ],
    },
  },
  optionalModals: ["tourOverlay", "comunicadoInicial"],
};

// ─── Guide pages — shared element catalog (step indicators, salvar) ──

function makeGuidePage(input: {
  id: string;
  title: string;
  ngPrefix: string;
  urlPath: string;
  stepCount: number;
  step1: Record<string, PortalElement>;
  nextStepButtonId: string;
}): PortalPage {
  const stepLinks: Record<string, PortalElement> = {};
  for (let i = 1; i <= input.stepCount; i++) {
    stepLinks[`stepLink${i}`] = {
      id: `stepLink${i}`,
      description: `Indicador da etapa ${i} (clicável quando etapas anteriores estão válidas).`,
      intent: `the step ${i} indicator link on the multi-step guide form`,
      candidates: [{ kind: "id", id: `linkGotoEtapa${i}` }],
    };
  }
  return {
    id: input.id,
    title: input.title,
    description: `Formulário multi-etapas (${input.stepCount} passos) da guia ${input.title}. ng-model prefix: ${input.ngPrefix}.`,
    url: new RegExp(`#\\/${input.urlPath}\\/`),
    elements: {
      ...input.step1,
      ...stepLinks,
      nextStepButton: {
        id: "nextStepButton",
        description: "Botão laranja 'Próxima etapa' (id varia por tipo).",
        intent: `the 'Próxima etapa' button that advances the ${input.title} form to the next step`,
        candidates: [
          { kind: "id", id: input.nextStepButtonId },
          { kind: "css", selector: 'button.orange:has-text("Próxima etapa")' },
        ],
      },
      adicionarItem: {
        id: "adicionarItem",
        description: "Link 'adicionar Item' para inserir um procedimento (TUSS) na guia.",
        intent: "the 'adicionar Item' link/button on the procedures step that opens the procedure entry form",
        candidates: [
          { kind: "css", selector: 'a.btn-radius:has-text("adicionar Item")' },
          { kind: "text", pattern: /^adicionar item$/i },
        ],
      },
      salvarGuia: {
        id: "salvarGuia",
        description: "Botão 'Salvar Guia' final (chama completarGuia()).",
        intent: "the orange 'Salvar Guia' button at the end of the procedure step",
        candidates: [
          { kind: "id", id: "salvarGuia" },
          { kind: "css", selector: 'button.orange:has-text("Salvar Guia")' },
        ],
      },
    },
    optionalModals: ["tourOverlay"],
  };
}

const guiaConsulta: PortalPage = makeGuidePage({
  id: "guiaConsulta",
  title: "Guia Consulta",
  ngPrefix: "guiaConsulta.Guia",
  urlPath: "guia_consulta",
  stepCount: 3,
  nextStepButtonId: "proximaEtapaAba1",
  step1: {
    registroANS: {
      id: "registroANS",
      description: "Registro ANS da operadora (pré-preenchido).",
      intent: "the 'Registro ANS' text input",
      candidates: [{ kind: "id", id: "guiaConsultaRegistroANS" }, { kind: "ngModel", value: "guiaConsulta.Guia.cabecalhoConsultaField.registroANSField" }],
    },
    nGuiaPrestador: {
      id: "nGuiaPrestador",
      description: "Número da guia no prestador.",
      intent: "the 'N° Guia Prestador' input",
      candidates: [{ kind: "id", id: "guiaConsultaNGuiaPrestador" }, { kind: "ngModel", value: "guiaConsulta.Guia.cabecalhoConsultaField.numeroGuiaPrestadorField" }],
    },
    nGuiaOperadora: {
      id: "nGuiaOperadora",
      description: "Número da guia na operadora.",
      intent: "the 'N° Guia Operadora' input",
      candidates: [{ kind: "id", id: "guiaConsultaNGuiaOperadora" }, { kind: "ngModel", value: "guiaConsulta.Guia.numeroGuiaOperadoraField" }],
    },
    numeroCarteira: {
      id: "numeroCarteira",
      description: "Número da carteira do beneficiário.",
      intent: "the 'Número da carteira' input",
      candidates: [{ kind: "id", id: "guiaConsultaNCarteirinha" }, { kind: "ngModel", value: "guiaConsulta.Guia.dadosBeneficiarioField.numeroCarteiraField" }],
    },
    tipoIdentificacao: {
      id: "tipoIdentificacao",
      description: "Select 'Tipo de Identificação do Beneficiário'.",
      intent: "the 'Tipo de Identificação do Beneficiário' select",
      candidates: [{ kind: "id", id: "identificacaoBeneficiario" }, { kind: "ngModel", value: "guiaConsulta.Guia.dadosBeneficiarioField.tipoIdentField" }],
    },
    ausenciaCodValidacao: {
      id: "ausenciaCodValidacao",
      description: "Select 'Ausência de código de validação'.",
      intent: "the 'Ausência de código de validação' select",
      candidates: [{ kind: "id", id: "ausenciaCodigoValidacao" }, { kind: "ngModel", value: "guiaConsulta.Guia.ausenciaCodValidacaoField" }],
    },
    codValidacao: {
      id: "codValidacao",
      description: "Código de validação.",
      intent: "the 'Código de Validação' text input",
      candidates: [{ kind: "id", id: "codigoValidacao" }, { kind: "ngModel", value: "guiaConsulta.Guia.codValidacaoField" }],
    },
    atendimentoRNSim: {
      id: "atendimentoRNSim",
      description: "Toggle 'Atendimento a RN' = Sim (value=1).",
      intent: "the 'Sim' toggle for 'Atendimento a RN'",
      candidates: [{ kind: "id", id: "radioButtonSim" }],
    },
    atendimentoRNNao: {
      id: "atendimentoRNNao",
      description: "Toggle 'Atendimento a RN' = Não (value=0).",
      intent: "the 'Não' toggle for 'Atendimento a RN'",
      candidates: [{ kind: "id", id: "radioButtonNao" }],
    },
  },
});

const guiaSadt: PortalPage = makeGuidePage({
  id: "guiaSadt",
  title: "Guia SP/SADT",
  ngPrefix: "guiaSADT.Guia",
  urlPath: "guia_sadt",
  stepCount: 5,
  nextStepButtonId: "proximaEtapaAba1",
  step1: {
    registroANS: {
      id: "registroANS",
      description: "Registro ANS da operadora.",
      intent: "the 'Registro ANS' input",
      candidates: [{ kind: "id", id: "guiaSADTregistroANS" }, { kind: "ngModel", value: "guiaSADT.Guia.cabecalhoGuiaField.registroANSField" }],
    },
    nGuiaPrestador: {
      id: "nGuiaPrestador",
      description: "Número da guia no prestador.",
      intent: "the 'N° Guia Prestador' input",
      candidates: [{ kind: "id", id: "guiaSADTnGuiaPrestador" }, { kind: "ngModel", value: "guiaSADT.Guia.cabecalhoGuiaField.numeroGuiaPrestadorField" }],
    },
    nGuiaPrincipal: {
      id: "nGuiaPrincipal",
      description: "Número da guia principal (solicitação de internação).",
      intent: "the 'N° Guia principal' input",
      candidates: [{ kind: "id", id: "guiaSADTnGuiaSolicInternacao" }, { kind: "ngModel", value: "guiaSADT.Guia.cabecalhoGuiaField.guiaPrincipalField" }],
    },
    nGuiaOperadora: {
      id: "nGuiaOperadora",
      description: "Número da guia na operadora.",
      intent: "the 'N° Guia Operadora' input",
      candidates: [{ kind: "id", id: "guiaSADTnGuiaOperadora" }, { kind: "ngModel", value: "guiaSADT.Guia.dadosAutorizacaoField.numeroGuiaOperadoraField" }],
    },
    dataAutorizacao: {
      id: "dataAutorizacao",
      description: "Data da autorização.",
      intent: "the 'Data da autorização' input",
      candidates: [{ kind: "id", id: "guiaSADTdataAutorizacao" }, { kind: "ngModel", value: "guiaSADT.Guia.dadosAutorizacaoField.dataAutorizacaoField" }],
    },
    senha: {
      id: "senha",
      description: "Senha de autorização.",
      intent: "the 'Senha' input on the SADT guide",
      candidates: [{ kind: "id", id: "guiaSADTsenha" }, { kind: "ngModel", value: "guiaSADT.Guia.dadosAutorizacaoField.senhaField" }],
    },
    dataValidadeSenha: {
      id: "dataValidadeSenha",
      description: "Data validade da senha.",
      intent: "the 'Data validade da senha' input",
      candidates: [{ kind: "id", id: "guiaSADTdataValidadeSenha" }, { kind: "ngModel", value: "guiaSADT.Guia.dadosAutorizacaoField.dataValidadeSenhaField" }],
    },
    ausenciaCodValidacao: {
      id: "ausenciaCodValidacao",
      description: "Select 'Ausência de código de validação'.",
      intent: "the 'Ausência de código de validação' select",
      candidates: [{ kind: "id", id: "ausenciaCodigoValidacao" }, { kind: "ngModel", value: "guiaSADT.Guia.dadosAutorizacaoField.ausenciaCodValidacaoField" }],
    },
    codValidacao: {
      id: "codValidacao",
      description: "Código de validação.",
      intent: "the 'Código de Validação' input",
      candidates: [{ kind: "id", id: "codigoValidacao" }, { kind: "ngModel", value: "guiaSADT.Guia.dadosAutorizacaoField.codValidacaoField" }],
    },
  },
});

const guiaHonorario: PortalPage = makeGuidePage({
  id: "guiaHonorario",
  title: "Guia Honorário",
  ngPrefix: "guiaHonorarios.Guia",
  urlPath: "guia_honorario",
  stepCount: 5,
  nextStepButtonId: "botaoGotoEtapa2",
  step1: {
    registroANS: {
      id: "registroANS",
      description: "Registro ANS da operadora.",
      intent: "the 'Registro ANS' input",
      candidates: [{ kind: "id", id: "registroANS" }, { kind: "ngModel", value: "guiaHonorarios.Guia.cabecalhoGuiaField.registroANSField" }],
    },
    nGuiaPrestador: {
      id: "nGuiaPrestador",
      description: "N° Guia Prestador.",
      intent: "the 'N° Guia Prestador' input",
      candidates: [{ kind: "id", id: "nGuiaPrestador" }, { kind: "ngModel", value: "guiaHonorarios.Guia.cabecalhoGuiaField.numeroGuiaPrestadorField" }],
    },
    nGuiaSolicInternacao: {
      id: "nGuiaSolicInternacao",
      description: "N° Guia solicitação internação.",
      intent: "the 'N° Guia Solic. Internação' input",
      candidates: [{ kind: "id", id: "nGuiaSolicInternacao" }, { kind: "ngModel", value: "guiaHonorarios.Guia.guiaSolicInternacaoField" }],
    },
    senha: {
      id: "senha",
      description: "Senha de autorização.",
      intent: "the 'Senha' input on the Honorário guide",
      candidates: [{ kind: "id", id: "senha" }, { kind: "ngModel", value: "guiaHonorarios.Guia.senhaField" }],
    },
    nGuiaOperadora: {
      id: "nGuiaOperadora",
      description: "N° Guia Operadora.",
      intent: "the 'N° Guia Operadora' input",
      candidates: [{ kind: "id", id: "nGuiaOperadora" }, { kind: "ngModel", value: "guiaHonorarios.Guia.numeroGuiaOperadoraField" }],
    },
    dataEmissaoGuia: {
      id: "dataEmissaoGuia",
      description: "Data de emissão da guia.",
      intent: "the 'Data emissão Guia' input",
      candidates: [{ kind: "id", id: "dataEmissaoGuia" }, { kind: "ngModel", value: "guiaHonorarios.Guia.dataEmissaoGuiaField" }],
    },
  },
});

const guiaInternacao: PortalPage = makeGuidePage({
  id: "guiaInternacao",
  title: "Guia Internação",
  ngPrefix: "guiaInternacao.Guia",
  urlPath: "guia_internacao",
  stepCount: 7,
  nextStepButtonId: "buttonGotoEtapa2",
  step1: {
    registroANS: {
      id: "registroANS",
      description: "Registro ANS da operadora.",
      intent: "the 'Registro ANS' input",
      candidates: [{ kind: "id", id: "guiaInternacaoregistroANS" }, { kind: "ngModel", value: "guiaInternacao.Guia.cabecalhoGuiaField.registroANSField" }],
    },
    nGuiaPrestador: {
      id: "nGuiaPrestador",
      description: "N° Guia Prestador.",
      intent: "the 'N° Guia Prestador' input",
      candidates: [{ kind: "id", id: "guiaInternacaonGuiaPrestador" }, { kind: "ngModel", value: "guiaInternacao.Guia.cabecalhoGuiaField.numeroGuiaPrestadorField" }],
    },
    nGuiaSolicInternacao: {
      id: "nGuiaSolicInternacao",
      description: "N° Guia solicitação internação.",
      intent: "the 'N° Guia Solic. Internação' input",
      candidates: [{ kind: "id", id: "guiaInternacaonGuiaSolicInternacao" }, { kind: "ngModel", value: "guiaInternacao.Guia.numeroGuiaSolicitacaoInternacaoField" }],
    },
    nGuiaOperadora: {
      id: "nGuiaOperadora",
      description: "N° Guia Operadora.",
      intent: "the 'N° Guia Operadora' input",
      candidates: [{ kind: "id", id: "guiaInternacaonGuiaOperadora" }, { kind: "ngModel", value: "guiaInternacao.Guia.dadosAutorizacaoField.numeroGuiaOperadoraField" }],
    },
    dataAutorizacao: {
      id: "dataAutorizacao",
      description: "Data da autorização.",
      intent: "the 'Data da Autorização' input",
      candidates: [{ kind: "id", id: "guiaInternacaodataAutorizacao" }, { kind: "ngModel", value: "guiaInternacao.Guia.dadosAutorizacaoField.dataAutorizacaoField" }],
    },
    senha: {
      id: "senha",
      description: "Senha de autorização.",
      intent: "the 'Senha' input on the Internação guide",
      candidates: [{ kind: "id", id: "guiaInternacaosenha" }, { kind: "ngModel", value: "guiaInternacao.Guia.dadosAutorizacaoField.senhaField" }],
    },
    validadeSenha: {
      id: "validadeSenha",
      description: "Data validade da senha.",
      intent: "the 'Data Validade da Senha' input",
      candidates: [{ kind: "id", id: "guiaInternacaovalidadeSenha" }, { kind: "ngModel", value: "guiaInternacao.Guia.dadosAutorizacaoField.dataValidadeSenhaField" }],
    },
    ausenciaCodValidacao: {
      id: "ausenciaCodValidacao",
      description: "Select 'Ausência de código de validação'.",
      intent: "the 'Ausência de código de validação' select",
      candidates: [{ kind: "id", id: "ausenciaCodigoValidacao" }, { kind: "ngModel", value: "guiaInternacao.Guia.dadosAutorizacaoField.ausenciaCodValidacaoField" }],
    },
    codValidacao: {
      id: "codValidacao",
      description: "Código de validação.",
      intent: "the 'Código de Validação' input",
      candidates: [{ kind: "id", id: "codigoValidacao" }, { kind: "ngModel", value: "guiaInternacao.Guia.dadosAutorizacaoField.codValidacaoField" }],
    },
  },
});

const guiaOdonto: PortalPage = makeGuidePage({
  id: "guiaOdonto",
  title: "Guia Odontológica",
  ngPrefix: "guiaOdontologia.Guia",
  urlPath: "guia_odonto",
  stepCount: 6,
  nextStepButtonId: "botaoGotoEtapa2",
  step1: {
    registroANS: {
      id: "registroANS",
      description: "Registro ANS da operadora.",
      intent: "the 'Registro ANS' input",
      candidates: [{ kind: "id", id: "guiaOdontoregistroANS" }, { kind: "ngModel", value: "guiaOdontologia.Guia.registroANSField" }],
    },
    nGuiaPrestador: {
      id: "nGuiaPrestador",
      description: "N° Guia Prestador.",
      intent: "the 'N° Guia Prestador' input",
      candidates: [{ kind: "id", id: "guiaOdontonGuiaPrestador" }, { kind: "ngModel", value: "guiaOdontologia.Guia.numeroGuiaPrestadorField" }],
    },
    nGuiaOperadora: {
      id: "nGuiaOperadora",
      description: "N° Guia Operadora.",
      intent: "the 'N° Guia Operadora' input",
      candidates: [{ kind: "id", id: "guiaOdontonGuiaOperadora" }, { kind: "ngModel", value: "guiaOdontologia.Guia.numeroGuiaOperadoraField" }],
    },
    nGuiaPrincipal: {
      id: "nGuiaPrincipal",
      description: "N° Guia Principal.",
      intent: "the 'N° Guia Principal' input",
      candidates: [{ kind: "id", id: "guiaOdontonGuiaPrincipal" }, { kind: "ngModel", value: "guiaOdontologia.Guia.numeroGuiaPrincipalField" }],
    },
    dataAutorizacao: {
      id: "dataAutorizacao",
      description: "Data da autorização.",
      intent: "the 'Data da Autorização' input",
      candidates: [{ kind: "id", id: "guiaOdontodataAutorizacao" }, { kind: "ngModel", value: "guiaOdontologia.Guia.dataAutorizacaoField" }],
    },
    senha: {
      id: "senha",
      description: "Senha de autorização.",
      intent: "the 'Senha Autorização' input on the Odonto guide",
      candidates: [{ kind: "id", id: "guiaOdontosenha" }, { kind: "ngModel", value: "guiaOdontologia.Guia.senhaAutorizacaoField" }],
    },
    validadeSenha: {
      id: "validadeSenha",
      description: "Validade da senha.",
      intent: "the 'Validade Senha' input",
      candidates: [{ kind: "id", id: "guiaOdontonValidadeSenha" }, { kind: "ngModel", value: "guiaOdontologia.Guia.validadeSenhaField" }],
    },
    ausenciaCodValidacao: {
      id: "ausenciaCodValidacao",
      description: "Select 'Ausência de código de validação'.",
      intent: "the 'Ausência de código de validação' select",
      candidates: [{ kind: "id", id: "ausenciaCodigoValidacao" }, { kind: "ngModel", value: "guiaOdontologia.Guia.ausenciaCodValidacaoField" }],
    },
    codValidacao: {
      id: "codValidacao",
      description: "Código de validação.",
      intent: "the 'Código de Validação' input",
      candidates: [{ kind: "id", id: "codigoValidacao" }, { kind: "ngModel", value: "guiaOdontologia.Guia.codValidacaoField" }],
    },
  },
});

// ─── Map ──────────────────────────────────────────────────────────────

export const orizonFaturePortalMap: PortalMap = {
  pages: {
    solutionsSelector,
    ssoLogin,
    dashboard,
    uploadTiss,
    confirmBatchesModal,
    digitarGuia,
    guiaConsulta,
    guiaSadt,
    guiaHonorario,
    guiaInternacao,
    guiaOdonto,
  },
  modals: {
    cookieBanner,
    comunicadoInicial,
    supportTerms,
    tourOverlay,
    lotesEnviadosSucesso,
  },
  flows: {
    short: {
      id: "short",
      label: "Fluxo curto",
      steps: [
        { pageId: "solutionsSelector", action: "click_or_skip", elementId: "fatureLogin" },
        { pageId: "ssoLogin", action: "fill_credentials" },
        { pageId: "dashboard", action: "dismiss_modal", modalId: "comunicadoInicial" },
        { pageId: "dashboard", action: "click", elementId: "enviarXmlTissSidebar" },
        { pageId: "uploadTiss", action: "set_file", elementId: "fileInput" },
        { pageId: "uploadTiss", action: "click", elementId: "selectAllCheckbox" },
        { pageId: "uploadTiss", action: "click", elementId: "enviarButton" },
        { pageId: "confirmBatchesModal", action: "click", elementId: "enviarValidosButton" },
      ],
    },
    complete: {
      id: "complete",
      label: "Fluxo completo",
      steps: [
        { pageId: "solutionsSelector", action: "click_or_skip", elementId: "fatureLogin" },
        { pageId: "ssoLogin", action: "fill_credentials" },
        { pageId: "dashboard", action: "dismiss_modal", modalId: "comunicadoInicial" },
        { pageId: "dashboard", action: "click", elementId: "digitarGuiasTile" },
        { pageId: "digitarGuia", action: "select_operadora_e_tipo" },
        { pageId: "digitarGuia", action: "click", elementId: "submitButton" },
        // Per-tipo guide form: walks N steps + procedimentos + salvar.
        { pageId: "guiaConsulta", action: "fill_guide_steps" },
      ],
    },
  },
  guideTypes: {
    consulta: {
      label: "Consulta",
      selectValue: "number:1",
      urlPath: "guia_consulta",
      pageId: "guiaConsulta",
      ngModelPrefix: "guiaConsulta.Guia",
      stepCount: 3,
      tissGuideName: "guiaConsulta",
      nextStepButtonId: (step) => (step === 1 ? "proximaEtapaAba1" : `proximaEtapaAba${step}`),
    },
    sadt: {
      label: "SP_SADT",
      selectValue: "number:2",
      urlPath: "guia_sadt",
      pageId: "guiaSadt",
      ngModelPrefix: "guiaSADT.Guia",
      stepCount: 5,
      tissGuideName: "guiaSP-SADT",
      nextStepButtonId: (step) => `proximaEtapaAba${step}`,
    },
    honorario: {
      label: "Honorário",
      selectValue: "number:3",
      urlPath: "guia_honorario",
      pageId: "guiaHonorario",
      ngModelPrefix: "guiaHonorarios.Guia",
      stepCount: 5,
      tissGuideName: "guiaHonorarios",
      nextStepButtonId: (step) => `botaoGotoEtapa${step + 1}`,
    },
    internacao: {
      label: "Internação",
      selectValue: "number:4",
      urlPath: "guia_internacao",
      pageId: "guiaInternacao",
      ngModelPrefix: "guiaInternacao.Guia",
      stepCount: 7,
      tissGuideName: "guiaResumoInternacao",
      nextStepButtonId: (step) => `buttonGotoEtapa${step + 1}`,
    },
    odonto: {
      label: "Odontologia",
      selectValue: "number:5",
      urlPath: "guia_odonto",
      pageId: "guiaOdonto",
      ngModelPrefix: "guiaOdontologia.Guia",
      stepCount: 6,
      tissGuideName: "guiaOdontologica",
      nextStepButtonId: (step) => `botaoGotoEtapa${step + 1}`,
    },
  },
};

// ─── URL helpers ──────────────────────────────────────────────────────

export const orizonHomeUrl = "https://www.orizon.com.br/";
export const orizonAcessoUrl =
  "https://www.orizon.com.br/acesso-restrito.html?csrt=3236892073016519116";
export const orizonSsoLoginUrl = ssoLoginUrl;

export type GuiaUrlParams = {
  idOperadora: number | string;
  idPrestador: number | string;
  tissVersion?: string;
  ans: number | string;
  templateGuia?: number | string;
  readOnly?: boolean;
  idGuia?: number | string;
};

export function buildGuiaUrl(tipoId: GuideTipoId, params: GuiaUrlParams): string {
  const tipo = orizonFaturePortalMap.guideTypes[tipoId];
  const tipoGuia = tipo.selectValue.replace("number:", "");
  const orizonEnc = [
    `IDOperadora=${params.idOperadora}`,
    `IDPrestador=${params.idPrestador}`,
    `TipoGuia=${tipoGuia}`,
    `Versao=${params.tissVersion ?? "4.02.00"}`,
    `IDVersao=undefined`,
    `reg_ans=${params.ans}`,
    `Template_Guia=${params.templateGuia ?? 0}`,
    `ReadOnly=${params.readOnly === false ? "False" : "True"}`,
    `IDGuia=${params.idGuia ?? 0}`,
  ].join(",");
  return `https://portal.orizon.com.br/fature/prestador.html#/${tipo.urlPath}/?OrizonEnc=${orizonEnc}/DIGITAR_GUIA`;
}

// ─── Locator composition ──────────────────────────────────────────────

function locatorForCandidate(page: Page, c: SelectorCandidate): Locator {
  switch (c.kind) {
    case "id":
      return page.locator(`#${cssEscapeId(c.id)}`);
    case "ngModel":
      return page.locator(`[ng-model="${c.value}"]`);
    case "css":
      return page.locator(c.selector);
    case "role":
      return page.getByRole(c.type, c.name ? { name: c.name } : undefined);
    case "text":
      return page.getByText(c.pattern, c.exact !== undefined ? { exact: c.exact } : undefined);
  }
}

function cssEscapeId(id: string): string {
  // Most IDs from the portal are simple identifiers, but escape just in case.
  return id.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function composeLocator(page: Page, candidates: SelectorCandidate[]): Locator {
  if (candidates.length === 0) {
    throw new Error("Element has no candidates");
  }
  let locator = locatorForCandidate(page, candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    locator = locator.or(locatorForCandidate(page, candidates[i]));
  }
  return locator.first();
}

// ─── Public helpers ───────────────────────────────────────────────────

export function getElement(pageId: string, elementId: string): PortalElement {
  const page = orizonFaturePortalMap.pages[pageId];
  if (!page) throw new Error(`Unknown portal page: ${pageId}`);
  const element = page.elements[elementId];
  if (!element) throw new Error(`Unknown element on ${pageId}: ${elementId}`);
  return element;
}

export function getModal(modalId: string): PortalModal {
  const modal = orizonFaturePortalMap.modals[modalId];
  if (!modal) throw new Error(`Unknown modal: ${modalId}`);
  return modal;
}

export function selectElement(page: Page, pageId: string, elementId: string): Locator {
  const element = getElement(pageId, elementId);
  return composeLocator(page, element.candidates);
}

export function selectModal(
  page: Page,
  modalId: string,
): { detect: Locator; action: Locator; requiresScrollAndJsClick: boolean } {
  const modal = getModal(modalId);
  return {
    detect: locatorForCandidate(page, modal.detect).first(),
    action: composeLocator(page, modal.primaryAction.candidates),
    requiresScrollAndJsClick: modal.requiresScrollAndJsClick === true,
  };
}

export function getElementIntentForVision(
  pageId: string,
  elementId: string,
): { intent: string; pageContext: string } {
  const page = orizonFaturePortalMap.pages[pageId];
  if (!page) throw new Error(`Unknown portal page: ${pageId}`);
  const element = page.elements[elementId];
  if (!element) throw new Error(`Unknown element on ${pageId}: ${elementId}`);
  return {
    intent: element.intent,
    pageContext: `You should be on the "${page.title}" page — ${page.description}`,
  };
}

export function describePortalForPrompt(): string {
  const lines: string[] = [];
  lines.push("# Mapa do portal Orizon Fature");
  lines.push("");
  lines.push("Páginas conhecidas:");
  for (const id of Object.keys(orizonFaturePortalMap.pages)) {
    const page = orizonFaturePortalMap.pages[id];
    const elementIds = Object.keys(page.elements);
    const sample = elementIds.slice(0, 4).join(", ");
    lines.push(`- ${id} (${page.title}): ${page.description.split(".")[0]}. Elementos: ${sample}${elementIds.length > 4 ? ", …" : ""}.`);
  }
  lines.push("");
  lines.push("Modais possíveis: " + Object.keys(orizonFaturePortalMap.modals).join(", ") + ".");
  lines.push("");
  lines.push("Fluxos:");
  for (const flowId of ["short", "complete"] as const) {
    const flow = orizonFaturePortalMap.flows[flowId];
    const path = flow.steps.map((s) => s.pageId).filter((p, i, arr) => arr[i - 1] !== p).join(" → ");
    lines.push(`- ${flow.label}: ${path}.`);
  }
  lines.push("");
  lines.push("Tipos de guia (Fluxo completo):");
  for (const tipoId of Object.keys(orizonFaturePortalMap.guideTypes) as GuideTipoId[]) {
    const t = orizonFaturePortalMap.guideTypes[tipoId];
    lines.push(`- ${t.label}: ${t.stepCount} etapas; pageId=${t.pageId}; TISS=${t.tissGuideName}.`);
  }
  return lines.join("\n");
}
