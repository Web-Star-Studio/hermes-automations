import type { Browser, Locator, Page } from "playwright-core";
import { mapTissToFields } from "@/lib/ai/field-mapper";
import { findElementWithVision } from "@/lib/ai/vision";
import {
  type GuideTipoId,
  type SelectorCandidate,
  buildGuiaUrl,
  getElement,
  getModal,
  orizonAcessoUrl,
  orizonFaturePortalMap,
  orizonSsoLoginUrl,
  selectElement,
  selectModal,
} from "@/lib/orizon/portal-map";
import {
  type FieldSnapshot,
  type IntrospectedField,
  snapshotOpenModalFields,
  snapshotPageFields,
} from "@/lib/orizon/runtime-introspection";

// ─── Public types ─────────────────────────────────────────────────────

export type OrizonTissFile = {
  fileName: string;
  bytes: Buffer;
  contentType: string;
};

export type OrizonProcedureToAdd = {
  codigo: string;
  descricao?: string | null;
  quantidade?: string | null;
  valorUnitario?: string | null;
  valorTotal?: string | null;
  dataExecucao?: string | null;
  codigoTabela?: string | null;
};

export type OrizonGuideToFill = {
  /** Index in the original TISS file's guides[] (used in events). */
  index: number;
  /** Resolved tipo id (consulta / sadt / honorario / internacao / odonto). */
  tipoId: GuideTipoId;
  /** Operadora ANS and IDOperadora (looked up from the dropdown's option text). */
  operadoraAns: string;
  /** Step-by-step values to fill (from `mapTissGuideToPortalSteps`). */
  steps: Array<{ step: number; values: Record<string, string | number | boolean> }>;
  /** Full procedure details for the procedimentos step. */
  procedures?: OrizonProcedureToAdd[];
  /** Raw TISS guide payload (for vision-driven fallback fill of unmapped fields). */
  tissData?: Record<string, unknown>;
  /** Display label for events. */
  label?: string;
};

export type OrizonLoginInput = {
  username: string;
  password: string;
  jobId?: string;
  flowType?: "short" | "complete";
  /** One or more files to upload (Orizon Fature accepts up to 50 .zip per submission). */
  tissFiles?: OrizonTissFile[];
  /** Required when flowType === "complete". */
  guidesToFill?: OrizonGuideToFill[];
  visionEnabled?: boolean;
  onProgress?: (event: OrizonProgressEvent) => Promise<void> | void;
};

export type OrizonProgressEvent =
  | { stage: "popup_dismissed" }
  | { stage: "upload_page_opened" }
  | { stage: "file_uploaded" }
  | { stage: "batches_selected" }
  | { stage: "submitted" }
  | { stage: "confirmed" }
  | { stage: "submission_succeeded" }
  | { stage: "digitar_guia_opened" }
  | { stage: "guide_started"; guideIndex: number; tipoId: GuideTipoId; label?: string }
  | { stage: "guide_step_filled"; guideIndex: number; step: number }
  | { stage: "guide_saved"; guideIndex: number }
  | { stage: "guide_failed"; guideIndex: number; reason: string }
  | { stage: "vision_recovery"; intent: string; selector?: string }
  | { stage: "log"; message: string };

export type OrizonLoginResult = {
  ok: boolean;
  mode: "browserbase";
  finalUrl?: string;
  sessionId?: string;
  debugUrl?: string;
  message: string;
  submitted?: boolean;
  guidesSaved?: number;
  guidesFailed?: number;
};

// ─── Top-level entry ──────────────────────────────────────────────────

export async function loginToOrizonFature(
  input: OrizonLoginInput,
): Promise<OrizonLoginResult> {
  return loginWithBrowserbase(input);
}

async function loginWithBrowserbase(input: OrizonLoginInput): Promise<OrizonLoginResult> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return {
      ok: false,
      mode: "browserbase",
      finalUrl: orizonSsoLoginUrl,
      message: "Browserbase nao configurado. Defina BROWSERBASE_API_KEY e BROWSERBASE_PROJECT_ID.",
    };
  }

  const [{ default: Browserbase }, { chromium }] = await Promise.all([
    import("@browserbasehq/sdk"),
    import("playwright-core"),
  ]);
  const browserbase = new Browserbase({ apiKey });
  const session = await browserbase.sessions.create({
    projectId,
    userMetadata: {
      jobId: input.jobId ?? "unknown",
      platform: "orizon_fature",
      purpose:
        input.flowType === "complete"
          ? "digitar_guia"
          : (input.tissFiles?.length ?? 0) > 0
            ? "submit_tiss"
            : "login",
    },
  });
  const browser = await chromium.connectOverCDP(session.connectUrl);

  try {
    const result = await performFlow(browser, input);
    return {
      ...result,
      mode: "browserbase",
      sessionId: session.id,
    };
  } finally {
    await browser.close();
  }
}

// ─── Flow orchestration ───────────────────────────────────────────────

async function performFlow(
  browser: Browser,
  input: OrizonLoginInput,
): Promise<Omit<OrizonLoginResult, "mode">> {
  const page = await browser.newPage();
  const visionEnabled = input.visionEnabled === true;

  try {
    await navigateToFatureLogin(page, visionEnabled, input.onProgress);
    await acceptAllCookies(page, visionEnabled, input.onProgress);

    await fillCredentials(page, input.username, input.password);

    const stillOnLogin = await page.locator('input[type="password"]').count();
    if (stillOnLogin > 0) {
      return {
        ok: false,
        finalUrl: page.url(),
        message: "Login Orizon nao avancou; revise credenciais ou MFA.",
      };
    }

    await acceptAllCookies(page, visionEnabled, input.onProgress);
    await dismissComunicadoInicial(page);

    const files = input.tissFiles ?? [];
    if (files.length === 0) {
      return { ok: true, finalUrl: page.url(), message: "Login Orizon concluido." };
    }

    if (input.flowType === "complete") {
      return await runFluxoCompleto(page, input, visionEnabled);
    }

    return await runFluxoCurto(page, input, visionEnabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha durante envio TISS.";
    return { ok: false, finalUrl: page.url(), message };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runFluxoCurto(
  page: Page,
  input: OrizonLoginInput,
  visionEnabled: boolean,
): Promise<Omit<OrizonLoginResult, "mode">> {
  await openUploadPage(page, visionEnabled, input.onProgress);
  await input.onProgress?.({ stage: "upload_page_opened" });

  await acceptSupportTerms(page);

  await uploadTissBatch(page, input.tissFiles ?? []);
  await input.onProgress?.({ stage: "file_uploaded" });

  await selectAllBatches(page, visionEnabled, input.onProgress);
  await input.onProgress?.({ stage: "batches_selected" });

  await submitBatches(page, visionEnabled, input.onProgress);
  await input.onProgress?.({ stage: "submitted" });

  await confirmSubmission(
    page,
    visionEnabled,
    (input.tissFiles ?? []).length,
    input.onProgress,
  );
  await input.onProgress?.({ stage: "confirmed" });

  await awaitSubmissionSuccess(page, visionEnabled, input.onProgress);
  await input.onProgress?.({ stage: "submission_succeeded" });

  return {
    ok: true,
    finalUrl: page.url(),
    message: "Lote TISS enviado e confirmado pela Orizon (Lotes enviados com sucesso!).",
    submitted: true,
  };
}

async function runFluxoCompleto(
  page: Page,
  input: OrizonLoginInput,
  visionEnabled: boolean,
): Promise<Omit<OrizonLoginResult, "mode">> {
  await openDigitarGuiaPage(page, visionEnabled, input.onProgress);
  await input.onProgress?.({ stage: "digitar_guia_opened" });
  await dismissTourOverlay(page);

  const guides = input.guidesToFill ?? [];
  if (guides.length === 0) {
    return {
      ok: true,
      finalUrl: page.url(),
      message: "Página 'Digitar Guia' aberta. Nenhuma guia para preencher (guidesToFill vazio).",
      submitted: true,
      guidesSaved: 0,
    };
  }

  let saved = 0;
  let failed = 0;

  for (const guide of guides) {
    try {
      await input.onProgress?.({
        stage: "guide_started",
        guideIndex: guide.index,
        tipoId: guide.tipoId,
        label: guide.label,
      });
      await fillAndSaveGuide(page, guide, visionEnabled, input.onProgress);
      saved++;
      await input.onProgress?.({ stage: "guide_saved", guideIndex: guide.index });

      // After saving, navigate back to digitar_guia for the next iteration.
      if (guide !== guides[guides.length - 1]) {
        await page.goto(`https://portal.orizon.com.br/fature/prestador.html#/digitar_guia/`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await dismissTourOverlay(page);
      }
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message : "erro desconhecido";
      await input.onProgress?.({ stage: "guide_failed", guideIndex: guide.index, reason });
      // Reset to the digitar_guia entrypoint so the next guide can start fresh.
      await page
        .goto(`https://portal.orizon.com.br/fature/prestador.html#/digitar_guia/`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        })
        .catch(() => undefined);
      await dismissTourOverlay(page);
    }
  }

  return {
    ok: saved > 0,
    finalUrl: page.url(),
    message: `Fluxo completo: ${saved} guia(s) salva(s), ${failed} falha(s).`,
    submitted: saved > 0,
    guidesSaved: saved,
    guidesFailed: failed,
  };
}

// ─── Login navigation ─────────────────────────────────────────────────

async function navigateToFatureLogin(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  // We start at orizon.com.br/acesso-restrito so the session collects cookies
  // on the root domain and the natural intermediate redirects, then click
  // the FATURE column's "Efetuar login". showForm() in the page is async and
  // sometimes flaky in headless — fall back to direct SSO URL on failure.
  try {
    await page.goto(orizonAcessoUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await acceptAllCookies(page, visionEnabled, onProgress);
    await clickWithVisionFallback({
      page,
      pageId: "solutionsSelector",
      elementId: "fatureLogin",
      timeoutMs: 15_000,
      visionEnabled,
      onProgress,
    });
    await page.waitForURL(/sso-fature\.orizon\.com\.br/, { timeout: 20_000 }).catch(() => undefined);
  } catch {
    // showForm() didn't redirect us (popup blocked, AJAX issue, etc.) — go direct.
  }

  // If we're still not on the SSO page, navigate there directly.
  if (!/sso-fature\.orizon\.com\.br/.test(page.url())) {
    await page.goto(orizonSsoLoginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
}

async function fillCredentials(page: Page, username: string, password: string) {
  await selectElement(page, "ssoLogin", "username").fill(username);
  await selectElement(page, "ssoLogin", "password").fill(password);

  // The SSO submit handler is async — first click sometimes no-ops, second works.
  await selectElement(page, "ssoLogin", "submit").click({ timeout: 5_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);

  if (await page.locator('input[type="password"]').count()) {
    // Retry once.
    await selectElement(page, "ssoLogin", "submit")
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);
  }
}

// ─── Modal handlers ───────────────────────────────────────────────────

async function acceptAllCookies(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  // Best-effort: try the map's primary action, fall back to vision if enabled.
  if (await tryClickModalAction(page, "cookieBanner")) return;

  if (!visionEnabled) return;

  await visionRecoverByMap({
    page,
    modalId: "cookieBanner",
    onProgress,
    action: async (locator) => {
      await locator.click({ timeout: 2_000 });
      await page.waitForTimeout(400);
    },
  }).catch(() => undefined);
}

async function dismissComunicadoInicial(page: Page) {
  // The Comunicado modal sits at the bottom of a long scrollable container
  // (~1800px). Playwright .click() fails on hit-testing because the button is
  // outside the viewport. The map flags requiresScrollAndJsClick — handle it.
  const modal = getModal("comunicadoInicial");
  const detect = page.locator("#mensagemInicialModalPrestador").first();
  if (!(await detect.count().catch(() => 0))) return;
  if (!(await detect.isVisible().catch(() => false))) return;

  await page
    .evaluate((id: string) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.scrollIntoView({ block: "center" });
      (btn as HTMLElement).click();
    }, modal.primaryAction.candidates.find((c) => c.kind === "id")?.kind === "id"
      ? (modal.primaryAction.candidates.find((c) => c.kind === "id") as { kind: "id"; id: string })
          .id
      : "botaoMensagemInicialModalPrestador")
    .catch(() => undefined);
  await page.waitForTimeout(800);
}

async function dismissTourOverlay(page: Page) {
  // Tour overlays appear on Digitar Guia and on each guide-type's first visit.
  // Click "Terminar" if present; ignore otherwise.
  const terminar = page
    .locator('button.btn-sm.btn-default')
    .filter({ hasText: /^terminar$/i })
    .first();
  if (await terminar.isVisible({ timeout: 1500 }).catch(() => false)) {
    await terminar.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

async function acceptSupportTerms(page: Page) {
  // The "Termo de Suporte" lives on the upload page. Disabled until the modal
  // body is scrolled to the end.
  const checkbox = selectElement(page, "uploadTiss", "fileInput"); // present means upload page is loaded
  await checkbox.waitFor({ state: "attached", timeout: 30_000 }).catch(() => undefined);

  const termsCheckbox = page.locator("#Li_Concordo_Suporte").first();
  if (!(await termsCheckbox.count().catch(() => 0))) return;

  const dialog = page
    .locator('[role="dialog"], [class*="modal"], [class*="Modal"]')
    .first();

  for (let attempt = 0; attempt < 8; attempt++) {
    await dialog
      .evaluate((el: Element) => {
        const candidates = [
          el,
          ...Array.from(el.querySelectorAll('[class*="modal-body"], [class*="scroll"], [class*="content"]')),
        ];
        for (const node of candidates) {
          const html = node as HTMLElement;
          if (html.scrollHeight > html.clientHeight) {
            html.scrollTop = html.scrollHeight;
          }
        }
      })
      .catch(() => undefined);
    await page.waitForTimeout(400);
    const disabled = await termsCheckbox.isDisabled().catch(() => true);
    if (!disabled) break;
  }

  await termsCheckbox.check({ force: true, timeout: 5_000 }).catch(async () => {
    await termsCheckbox.click({ force: true, timeout: 5_000 }).catch(() => undefined);
  });

  const acceptButton = page
    .getByRole("button", { name: /^(aceitar|aceito|continuar|concordar|prosseguir|ok)$/i })
    .or(page.locator('button:has-text("Aceitar")'))
    .or(page.locator('button:has-text("Continuar")'))
    .first();
  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
}

async function tryClickModalAction(page: Page, modalId: string): Promise<boolean> {
  const { action } = selectModal(page, modalId);
  try {
    if (await action.isVisible({ timeout: 1500 }).catch(() => false)) {
      await action.click({ timeout: 2_000 });
      await page.waitForTimeout(400);
      return true;
    }
  } catch {
    // Fall through.
  }
  return false;
}

// ─── Short flow helpers ───────────────────────────────────────────────

async function openUploadPage(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  await clickWithVisionFallback({
    page,
    pageId: "dashboard",
    elementId: "enviarXmlTissSidebar",
    timeoutMs: 30_000,
    visionEnabled,
    onProgress,
  });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page
    .getByText(/selecione um ou mais arquivos compactados/i)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function uploadTissBatch(page: Page, files: OrizonTissFile[]) {
  if (files.length === 0) {
    throw new Error("Nenhum arquivo para enviar.");
  }

  // Defense in depth: if any file came back from storage as zero-byte
  // (e.g., R2 read returned an empty body, blob URL was bad), fail early
  // with a clear error instead of letting Playwright upload garbage.
  const empty = files.find((f) => !f.bytes || f.bytes.byteLength === 0);
  if (empty) {
    throw new Error(
      `Arquivo '${empty.fileName}' chegou vazio da camada de storage. Verifique a integridade do upload (R2/local-fs).`,
    );
  }

  const fileInput = selectElement(page, "uploadTiss", "fileInput");
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });

  // Playwright accepts an array — Orizon's input renders one row per file.
  await fileInput.setInputFiles(
    files.map((file) => ({
      name: file.fileName,
      mimeType: file.contentType || "application/zip",
      buffer: file.bytes,
    })),
  );

  // Validate the list actually rendered. Naive `getByText(filename)` matches
  // hidden placeholders too, so we instead poll the DOM until we see the
  // expected number of upload-list checkboxes (the column-header select-all
  // + one per file row). If the count doesn't reach files.length + 1 within
  // the timeout, dump the page state into the error so we know exactly what
  // the portal showed (or didn't).
  const expectedRowCheckboxes = files.length;
  const deadline = Date.now() + 90_000;
  let lastSeen = -1;
  while (Date.now() < deadline) {
    const rows = await page.evaluate(() => {
      const checkboxes = Array.from(
        document.querySelectorAll('input[type="checkbox"]:not([disabled])'),
      ).filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = window.getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      });
      // Subtract one for the column-header select-all if present.
      const selectAll = document.querySelector("input.ckbExcluirTodosArquivo");
      return Math.max(checkboxes.length - (selectAll ? 1 : 0), 0);
    });
    if (rows >= expectedRowCheckboxes) return;
    lastSeen = rows;
    await page.waitForTimeout(800);
  }

  const diagnostic = await page.evaluate((expectedNames: string[]) => {
    const namesSeen = expectedNames.filter((n) =>
      Array.from(document.body.querySelectorAll("*")).some((el) =>
        (el.textContent ?? "").includes(n),
      ),
    );
    const errorTexts = Array.from(
      document.querySelectorAll(".alert-danger, .error, .text-danger, [role='alert']"),
    )
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 3);
    return { url: window.location.href, namesSeen, errorTexts };
  }, files.map((f) => f.fileName));
  throw new Error(
    `Lista de uploads nao renderizou ${expectedRowCheckboxes} arquivo(s). ` +
      `Visiveis: ${lastSeen}. URL: ${diagnostic.url}. ` +
      `Nomes encontrados no DOM: [${diagnostic.namesSeen.join(", ")}]. ` +
      `Erros visiveis: [${diagnostic.errorTexts.join(" | ") || "nenhum"}].`,
  );
}

async function selectAllBatches(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  const checkbox = selectElement(page, "uploadTiss", "selectAllCheckbox");
  try {
    await checkbox.waitFor({ state: "visible", timeout: 15_000 });
    if (!(await checkbox.isChecked().catch(() => false))) {
      await checkbox.check({ timeout: 5_000 }).catch(async () => {
        await checkbox.click({ force: true, timeout: 5_000 });
      });
    }
  } catch (error) {
    if (!visionEnabled) throw error;
    await visionRecoverByMap({
      page,
      pageId: "uploadTiss",
      elementId: "selectAllCheckbox",
      onProgress,
      action: async (locator) => {
        if (!(await locator.isChecked().catch(() => false))) {
          await locator.click({ force: true, timeout: 5_000 });
        }
      },
    });
  }
}

async function submitBatches(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  await clickWithVisionFallback({
    page,
    pageId: "uploadTiss",
    elementId: "enviarButton",
    timeoutMs: 15_000,
    visionEnabled,
    onProgress,
  });
}

async function confirmSubmission(
  page: Page,
  visionEnabled: boolean,
  expectedFileCount: number,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  // The "Confirmar dados dos lotes" modal opens immediately after Enviar but
  // each row starts in "Validando..." state. Clicking "Enviar arquivos
  // válidos" while validation is still running submits with empty/partial
  // results — we need to wait for every row to settle into either
  // "Arquivo válido para envio." or an error label.
  await waitForBatchValidation(page, expectedFileCount, onProgress);
  await clickWithVisionFallback({
    page,
    pageId: "confirmBatchesModal",
    elementId: "enviarValidosButton",
    timeoutMs: 30_000,
    visionEnabled,
    onProgress,
  });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}

async function waitForBatchValidation(
  page: Page,
  expectedFileCount: number,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  const modalLocator = page
    .locator('.modal.in, .modal.show, [role="dialog"]:not([aria-hidden="true"])')
    .filter({ hasText: /confirmar dados dos lotes/i })
    .first();
  await modalLocator.waitFor({ state: "visible", timeout: 30_000 });

  const deadline = Date.now() + 180_000;
  let lastValidating = -1;
  let lastValidos = -1;
  while (Date.now() < deadline) {
    const state = await modalLocator
      .evaluate((root) => {
        const text = (root as HTMLElement).innerText ?? "";
        const validating = (text.match(/Validando\.\.\./gi) ?? []).length;
        const validos = (text.match(/Arquivo v[aá]lido para envio\./gi) ?? []).length;
        const invalidos = (text.match(/Arquivo inv[aá]lido/gi) ?? []).length;
        return { validating, validos, invalidos };
      })
      .catch(() => null);

    if (!state) {
      await page.waitForTimeout(800);
      continue;
    }

    if (
      state.validating === 0 &&
      state.validos + state.invalidos >= Math.max(1, expectedFileCount)
    ) {
      await onProgress?.({
        stage: "log",
        message: `Validação Orizon concluída: ${state.validos} válido(s), ${state.invalidos} inválido(s).`,
      });
      return;
    }

    if (state.validating !== lastValidating || state.validos !== lastValidos) {
      lastValidating = state.validating;
      lastValidos = state.validos;
      await onProgress?.({
        stage: "log",
        message: `Aguardando validação Orizon: ${state.validating} validando, ${state.validos} válido(s).`,
      });
    }

    await page.waitForTimeout(800);
  }

  throw new Error(
    `Validação dos lotes não concluiu em 180s (modal "Confirmar dados dos lotes" ainda mostra "Validando...").`,
  );
}

async function awaitSubmissionSuccess(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  // After "Enviar arquivos válidos" the portal pops a success modal with
  // title "Lotes enviados com sucesso!" + two buttons:
  // 'Enviar mais lotes' and 'Ir para Lista de Lotes'.
  //
  // Important: the title <h1> is templated into the DOM at all times via
  // Angular ng-show, so naive text matching always finds a hidden element.
  // Scope to an OPEN Bootstrap modal (.modal.in / .modal.show, or
  // [role="dialog"] not hidden) and key on the action button — buttons
  // only render once the modal actually opens.
  const successButton = page
    .locator('.modal.in, .modal.show, [role="dialog"]:not([aria-hidden="true"])')
    .filter({ hasText: /lotes enviados com sucesso/i })
    .getByRole("button", { name: /^enviar mais lotes$/i })
    .first();

  try {
    await successButton.waitFor({ state: "visible", timeout: 60_000 });
  } catch (error) {
    if (visionEnabled) {
      // Last resort: ask vision whether the success state actually rendered
      // somewhere we missed (different modal class, different layout, etc.).
      try {
        await visionRecoverByMap({
          page,
          modalId: "lotesEnviadosSucesso",
          onProgress,
          action: async (locator) => {
            await locator.click({ timeout: 5_000 });
          },
        });
        return;
      } catch {
        // Fall through to the structured error.
      }
    }
    const diagnostics = await captureSubmissionDiagnostics(page);
    throw new Error(
      `Modal de sucesso "Lotes enviados com sucesso!" nao apareceu em 60s. ${diagnostics}`,
      { cause: error },
    );
  }

  await successButton.click({ timeout: 5_000 });
  await page.waitForTimeout(600);
}

/**
 * Inspects the page state after a submission timeout and returns a
 * structured one-line diagnostic. Helps tell apart "the click missed",
 * "the portal silently rejected", and "the success modal auto-dismissed
 * before we caught it".
 */
async function captureSubmissionDiagnostics(page: Page): Promise<string> {
  try {
    const state = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = window.getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      };
      const trim = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

      const confirmModalOpen = Array.from(document.querySelectorAll(".modal.in")).some((m) =>
        /confirmar dados dos lotes/i.test(m.textContent ?? ""),
      );
      const errorTexts = Array.from(
        document.querySelectorAll(".alert-danger, .error, .text-danger, [role='alert']"),
      )
        .filter(visible)
        .map((el) => trim(el.textContent ?? ""))
        .filter(Boolean)
        .slice(0, 3);
      const fileRowCount = document.querySelectorAll(".ckbExcluirTodosArquivo").length
        ? Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(visible).length - 1
        : 0;

      return {
        url: window.location.href,
        bodyHasModalOpen: document.body.classList.contains("modal-open"),
        confirmModalOpen,
        errorTexts,
        fileRowCount: Math.max(fileRowCount, 0),
      };
    });

    const parts: string[] = [`url=${state.url}`];
    if (state.bodyHasModalOpen) parts.push("modal-open");
    if (state.confirmModalOpen) parts.push("confirm-modal-still-open (click missed?)");
    if (state.fileRowCount > 0) parts.push(`fileRows=${state.fileRowCount}`);
    if (state.errorTexts.length) parts.push(`errors=[${state.errorTexts.join(" | ")}]`);
    return parts.join("; ");
  } catch {
    return "diagnostico nao disponivel";
  }
}

// ─── Long flow helpers ───────────────────────────────────────────────

async function openDigitarGuiaPage(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  await clickWithVisionFallback({
    page,
    pageId: "dashboard",
    elementId: "digitarGuiasTile",
    timeoutMs: 30_000,
    visionEnabled,
    onProgress,
  });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  // Confirm we landed by waiting for the Operadora select.
  await selectElement(page, "digitarGuia", "operadoraSelect").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function selectOperadoraByAns(page: Page, ans: string | number): Promise<string> {
  // Operadora option values are `${IDOperadora}:${ANS}`. Find the option whose
  // visible text contains "(ANS: <ans>)" and assign it via JS so Angular picks
  // up the change.
  const ansStr = String(ans);
  const result = await page.evaluate((wantedAns: string) => {
    const sel = document.getElementById("operadora") as HTMLSelectElement | null;
    if (!sel) return { ok: false, reason: "select not found" };
    const re = new RegExp(`\\bANS:\\s*0*${wantedAns}\\b`, "i");
    const opt = Array.from(sel.options).find((o) => re.test(o.textContent ?? ""));
    if (!opt) return { ok: false, reason: `no option for ANS ${wantedAns}` };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    type AngularGlobal = { element?: (el: Element) => { scope?: () => { $apply?: () => void } } };
    const ng = (window as unknown as { angular?: AngularGlobal }).angular;
    if (ng?.element) {
      try {
        ng.element(sel).scope?.()?.$apply?.();
      } catch {
        // Ignore scope errors.
      }
    }
    return { ok: true, value: opt.value, text: opt.textContent ?? "" };
  }, ansStr);
  if (!result.ok) {
    throw new Error(`Operadora não encontrada para ANS ${ans}: ${result.reason}`);
  }
  return result.value as string;
}

async function selectTipoGuia(page: Page, tipoId: GuideTipoId) {
  const tipo = orizonFaturePortalMap.guideTypes[tipoId];
  await page.evaluate((value: string) => {
    const sel = document.getElementById("tipoDeGuia") as HTMLSelectElement | null;
    if (!sel) throw new Error("tipoDeGuia select not found");
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    type AngularGlobal = { element?: (el: Element) => { scope?: () => { $apply?: () => void } } };
    const ng = (window as unknown as { angular?: AngularGlobal }).angular;
    if (ng?.element) {
      try {
        ng.element(sel).scope?.()?.$apply?.();
      } catch {
        // Ignore.
      }
    }
  }, tipo.selectValue);
}

async function clickDigitarGuiaSubmit(
  page: Page,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  // The button's onclick navigates the SPA route. Click via JS to bypass any
  // visual-state issues (the button is dimmed orange briefly).
  await page.evaluate(() => {
    const btn = document.getElementById("botaoDigitarGuia");
    if (btn) (btn as HTMLElement).click();
  });
  // Wait for the route to change.
  await page
    .waitForURL(/#\/(guia_consulta|guia_sadt|guia_honorario|guia_internacao|guia_odonto)/, {
      timeout: 15_000,
    })
    .catch(async () => {
      // Fall back to deterministic + vision click.
      await clickWithVisionFallback({
        page,
        pageId: "digitarGuia",
        elementId: "submitButton",
        timeoutMs: 10_000,
        visionEnabled,
        onProgress,
      });
      await page
        .waitForURL(/#\/(guia_consulta|guia_sadt|guia_honorario|guia_internacao|guia_odonto)/, {
          timeout: 15_000,
        })
        .catch(() => undefined);
    });
}

async function fillGuideStep(
  page: Page,
  tipoId: GuideTipoId,
  step: number,
  values: Record<string, string | number | boolean>,
  options: {
    tissData?: Record<string, unknown>;
    visionEnabled: boolean;
  },
) {
  const tipo = orizonFaturePortalMap.guideTypes[tipoId];
  const pageId = tipo.pageId;
  const filledIds = new Set<string>();

  // 1) Fill statically-mapped fields.
  for (const [elementId, value] of Object.entries(values)) {
    try {
      const locator = selectElement(page, pageId, elementId);
      await locator.waitFor({ state: "visible", timeout: 5_000 });
      await fillByLocator(locator, value);
      // Track the actual id we filled (resolves through the map's first id candidate).
      const el = orizonFaturePortalMap.pages[pageId].elements[elementId];
      const idCandidate = el.candidates.find((c) => c.kind === "id");
      if (idCandidate?.kind === "id") filledIds.add(idCandidate.id);
    } catch {
      // Skip — runtime fallback may pick it up below.
    }
  }

  // 2) Runtime fallback for any remaining TISS data: introspect visible
  //    fields, ask the LLM mapper to map TISS data → fields. Only when
  //    vision is enabled (it costs a model call).
  if (options.visionEnabled && options.tissData && Object.keys(options.tissData).length > 0) {
    try {
      const snapshot = await snapshotPageFields(page);
      const remainingFields = snapshot.fields.filter(
        (f) => !f.disabled && !(f.id && filledIds.has(f.id)),
      );
      if (remainingFields.length > 0) {
        const reduced: FieldSnapshot = { ...snapshot, fields: remainingFields };
        const mapping = await mapTissToFields({
          snapshot: reduced,
          tissData: options.tissData,
          pageContext: `${tipo.label} — etapa ${step}`,
        });
        for (const assignment of mapping.assignments) {
          await applyAssignment(page, remainingFields, assignment).catch(() => undefined);
        }
      }
    } catch {
      // Silent — runtime fallback is opportunistic.
    }
  }
}

async function fillByLocator(
  locator: Locator,
  value: string | number | boolean,
): Promise<void> {
  const tag = await locator.evaluate((el: Element) => el.tagName).catch(() => "");
  if (tag === "SELECT") {
    await locator.selectOption({ value: String(value) }).catch(async () => {
      await locator.evaluate((el: Element, v: string) => {
        const sel = el as HTMLSelectElement;
        sel.value = v;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, String(value));
    });
    return;
  }
  if (typeof value === "boolean") {
    if (value) await locator.check({ force: true, timeout: 3_000 }).catch(() => undefined);
    else await locator.uncheck({ force: true, timeout: 3_000 }).catch(() => undefined);
    return;
  }
  await locator.fill(String(value), { timeout: 3_000 });
}

async function applyAssignment(
  page: Page,
  fields: IntrospectedField[],
  assignment: { fieldKey: string; value: string },
): Promise<void> {
  const field = fields.find(
    (f) => f.id === assignment.fieldKey || f.cssPath === assignment.fieldKey,
  );
  if (!field) return;
  const selector = field.id ? `#${cssEscape(field.id)}` : field.cssPath;
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
  if (field.kind === "select") {
    await locator
      .selectOption({ value: assignment.value })
      .catch(async () =>
        locator.selectOption({ label: assignment.value }).catch(() => undefined),
      );
    return;
  }
  if (field.kind === "checkbox" || field.kind === "radio") {
    const truthy = /^(true|1|sim|yes|on|checked)$/i.test(assignment.value.trim());
    if (truthy) await locator.check({ force: true, timeout: 3_000 }).catch(() => undefined);
    else await locator.uncheck({ force: true, timeout: 3_000 }).catch(() => undefined);
    return;
  }
  await locator.fill(assignment.value, { timeout: 3_000 }).catch(() => undefined);
}

function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

async function advanceGuideStep(
  page: Page,
  tipoId: GuideTipoId,
  fromStep: number,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  const tipo = orizonFaturePortalMap.guideTypes[tipoId];
  const buttonId = tipo.nextStepButtonId(fromStep);
  const candidates: SelectorCandidate[] = [
    { kind: "id", id: buttonId },
    { kind: "css", selector: 'button.orange:has-text("Próxima etapa")' },
  ];
  const locator = composeFromCandidates(page, candidates);

  try {
    await locator.waitFor({ state: "visible", timeout: 10_000 });
    await locator.click({ timeout: 5_000 });
  } catch (error) {
    if (!visionEnabled) throw error;
    await visionRecoverByMap({
      page,
      pageId: tipo.pageId,
      elementId: "nextStepButton",
      onProgress,
      action: async (l) => {
        await l.click({ timeout: 5_000 });
      },
    });
  }
  await page.waitForTimeout(600);
}

async function addProcedimento(
  page: Page,
  tipoId: GuideTipoId,
  procedure: OrizonProcedureToAdd,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  const pageId = orizonFaturePortalMap.guideTypes[tipoId].pageId;

  // 1) Open the procedure-add modal.
  await clickWithVisionFallback({
    page,
    pageId,
    elementId: "adicionarItem",
    timeoutMs: 10_000,
    visionEnabled,
    onProgress,
  });

  // 2) Wait for the modal and snapshot it.
  await page.waitForTimeout(600);
  const snapshot = await snapshotOpenModalFields(page);
  if (!snapshot) {
    throw new Error(`Procedimento modal nao abriu para ${procedure.codigo}.`);
  }

  // 3) Try a few obvious deterministic fills first (TUSS code in any input
  //    that mentions "código" / "TUSS" / "procedimento"). These are best-effort.
  const codigoField = snapshot.fields.find(
    (f) =>
      f.kind === "text" &&
      /(c[óo]digo|tuss|procedimento)/i.test(`${f.label} ${f.placeholder ?? ""} ${f.ngModel ?? ""}`),
  );
  if (codigoField) {
    const selector = codigoField.id ? `#${cssEscape(codigoField.id)}` : codigoField.cssPath;
    await page
      .locator(selector)
      .first()
      .fill(procedure.codigo, { timeout: 3_000 })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    // Many TUSS lookup widgets show suggestions; press Enter to commit the typed code.
    await page.locator(selector).first().press("Enter").catch(() => undefined);
    await page.waitForTimeout(500);
  }

  // 4) Vision fallback for the rest of the modal — only if vision is enabled.
  if (visionEnabled) {
    try {
      const refreshed = (await snapshotOpenModalFields(page)) ?? snapshot;
      const tissData: Record<string, unknown> = {
        codigoProcedimento: procedure.codigo,
        descricaoProcedimento: procedure.descricao,
        quantidade: procedure.quantidade,
        valorUnitario: procedure.valorUnitario,
        valorTotal: procedure.valorTotal,
        dataExecucao: procedure.dataExecucao,
        codigoTabela: procedure.codigoTabela,
      };
      const mapping = await mapTissToFields({
        snapshot: refreshed,
        tissData,
        pageContext: "Modal 'Adicionar Item' / procedimento TUSS",
      });
      for (const assignment of mapping.assignments) {
        await applyAssignment(page, refreshed.fields, assignment).catch(() => undefined);
      }
    } catch {
      // Vision step is best-effort — fall through to the save-button click.
    }
  }

  // 5) Click the modal's save button. Match common patterns.
  const saveBtn = page
    .locator('.modal.in, [role="dialog"]')
    .getByRole("button", { name: /^(salvar|adicionar|incluir|confirmar|ok)$/i })
    .or(page.locator('.modal.in button:has-text("Salvar")'))
    .or(page.locator('.modal.in button:has-text("Adicionar")'))
    .first();
  if (await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await saveBtn.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
}

async function salvarGuia(
  page: Page,
  tipoId: GuideTipoId,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  const pageId = orizonFaturePortalMap.guideTypes[tipoId].pageId;
  await clickWithVisionFallback({
    page,
    pageId,
    elementId: "salvarGuia",
    timeoutMs: 10_000,
    visionEnabled,
    onProgress,
  });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}

async function fillAndSaveGuide(
  page: Page,
  guide: OrizonGuideToFill,
  visionEnabled: boolean,
  onProgress?: OrizonLoginInput["onProgress"],
) {
  // 1) On the digitar_guia entry, select operadora + tipo and submit.
  await selectOperadoraByAns(page, guide.operadoraAns);
  await selectTipoGuia(page, guide.tipoId);
  await clickDigitarGuiaSubmit(page, visionEnabled, onProgress);
  await dismissTourOverlay(page);

  const tipo = orizonFaturePortalMap.guideTypes[guide.tipoId];

  // 2) Walk steps 1..N-1 (last step is procedimentos + Salvar).
  for (let s = 1; s < tipo.stepCount; s++) {
    const stepValues = guide.steps.find((x) => x.step === s)?.values ?? {};
    await fillGuideStep(page, guide.tipoId, s, stepValues, {
      tissData: guide.tissData,
      visionEnabled,
    });
    await onProgress?.({ stage: "guide_step_filled", guideIndex: guide.index, step: s });
    await advanceGuideStep(page, guide.tipoId, s, visionEnabled, onProgress);
  }

  // 3) Add procedures via the modal handler.
  for (const procedure of guide.procedures ?? []) {
    await addProcedimento(page, guide.tipoId, procedure, visionEnabled, onProgress).catch(() => {
      // Per-procedure failures don't abort the whole guide — surface via vision_recovery / log.
    });
  }

  // 4) Salvar Guia.
  await salvarGuia(page, guide.tipoId, visionEnabled, onProgress);
}

// ─── Click & vision helpers ───────────────────────────────────────────

async function clickWithVisionFallback(input: {
  page: Page;
  pageId: string;
  elementId: string;
  timeoutMs: number;
  visionEnabled: boolean;
  onProgress?: OrizonLoginInput["onProgress"];
}) {
  const primary = selectElement(input.page, input.pageId, input.elementId);
  try {
    await primary.waitFor({ state: "visible", timeout: input.timeoutMs });
    await primary.click({ timeout: 5_000 });
    return;
  } catch (error) {
    if (!input.visionEnabled) throw error;
    await visionRecoverByMap({
      page: input.page,
      pageId: input.pageId,
      elementId: input.elementId,
      onProgress: input.onProgress,
      action: async (locator) => {
        await locator.click({ timeout: 5_000 });
      },
    });
  }
}

async function visionRecoverByMap(input: {
  page: Page;
  pageId?: string;
  elementId?: string;
  modalId?: string;
  onProgress?: OrizonLoginInput["onProgress"];
  action: (locator: Locator) => Promise<void>;
}) {
  const screenshot = await input.page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
  const { intent, friendly } = resolveVisionTarget(input);
  const guess =
    input.pageId && input.elementId
      ? await findElementWithVision({
          screenshot,
          pageId: input.pageId,
          elementId: input.elementId,
        })
      : await findElementWithVision({ screenshot, intent });

  if (!guess.found) {
    throw new Error(`Visão nao localizou o elemento: ${friendly}. ${guess.reason}`);
  }

  let locator: Locator | null = null;
  if (guess.selector) {
    locator = input.page.locator(guess.selector).first();
  } else if (guess.textHint) {
    locator = input.page.getByText(guess.textHint, { exact: false }).first();
  }

  if (!locator) {
    throw new Error(`Visão nao retornou seletor utilizavel para: ${friendly}`);
  }

  await input.onProgress?.({ stage: "vision_recovery", intent, selector: guess.selector });
  await locator.waitFor({ state: "visible", timeout: 5_000 });
  await input.action(locator);
}

function resolveVisionTarget(input: {
  pageId?: string;
  elementId?: string;
  modalId?: string;
}): { intent: string; friendly: string } {
  if (input.modalId) {
    const modal = getModal(input.modalId);
    return {
      intent: modal.primaryAction.intent,
      friendly: `${modal.id}.primaryAction`,
    };
  }
  if (input.pageId && input.elementId) {
    const element = getElement(input.pageId, input.elementId);
    return {
      intent: element.intent,
      friendly: `${input.pageId}.${input.elementId}`,
    };
  }
  return { intent: "the target element", friendly: "(unknown)" };
}

function composeFromCandidates(page: Page, candidates: SelectorCandidate[]): Locator {
  // Mirror of the map's locator composer; used for ad-hoc per-tipo button ids.
  let locator: Locator | null = null;
  for (const c of candidates) {
    let next: Locator;
    switch (c.kind) {
      case "id":
        next = page.locator(`#${c.id}`);
        break;
      case "ngModel":
        next = page.locator(`[ng-model="${c.value}"]`);
        break;
      case "css":
        next = page.locator(c.selector);
        break;
      case "role":
        next = page.getByRole(c.type, c.name ? { name: c.name } : undefined);
        break;
      case "text":
        next = page.getByText(c.pattern, c.exact !== undefined ? { exact: c.exact } : undefined);
        break;
    }
    locator = locator ? locator.or(next) : next;
  }
  if (!locator) throw new Error("composeFromCandidates: empty candidates");
  return locator.first();
}

// Backward-compat: `buildGuiaUrl` re-export so other modules can import it.
export { buildGuiaUrl };

// ─── Granular session API (used by agent-callable workflow tools) ────

export type OrizonOpenSessionInput = {
  username: string;
  password: string;
  jobId: string;
  visionEnabled?: boolean;
};

export type OrizonOpenSessionResult = {
  ok: boolean;
  browserbaseSessionId?: string;
  connectUrl?: string;
  finalUrl?: string;
  message: string;
};

/**
 * Opens a Browserbase session with keepAlive=true, drives the login flow,
 * and returns the session metadata so subsequent tool calls can reconnect.
 * The session stays alive until explicitly closed (or until Browserbase's
 * project-level timeout).
 */
export async function openPortalSession(
  input: OrizonOpenSessionInput,
): Promise<OrizonOpenSessionResult> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return {
      ok: false,
      message: "Browserbase nao configurado.",
    };
  }

  const [{ default: Browserbase }, { chromium }] = await Promise.all([
    import("@browserbasehq/sdk"),
    import("playwright-core"),
  ]);
  const browserbase = new Browserbase({ apiKey });
  const session = await browserbase.sessions.create({
    projectId,
    keepAlive: true,
    userMetadata: {
      jobId: input.jobId,
      platform: "orizon_fature",
      purpose: "granular_session",
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const page = await browser.newPage();
    const visionEnabled = input.visionEnabled === true;
    await navigateToFatureLogin(page, visionEnabled);
    await acceptAllCookies(page, visionEnabled);
    await fillCredentials(page, input.username, input.password);

    if (await page.locator('input[type="password"]').count()) {
      return {
        ok: false,
        browserbaseSessionId: session.id,
        connectUrl: session.connectUrl,
        finalUrl: page.url(),
        message: "Login Orizon nao avancou.",
      };
    }

    await acceptAllCookies(page, visionEnabled);
    await dismissComunicadoInicial(page);

    return {
      ok: true,
      browserbaseSessionId: session.id,
      connectUrl: session.connectUrl,
      finalUrl: page.url(),
      message: "Sessao Orizon Fature aberta.",
    };
  } finally {
    // Important: do NOT close the browser — keepAlive keeps the session for
    // future runPortalActions calls to reconnect.
    await browser.close().catch(() => undefined);
  }
}

export type PortalAction =
  | { kind: "click"; pageId: string; elementId: string }
  | { kind: "fill"; pageId: string; elementId: string; value: string }
  | { kind: "select"; pageId: string; elementId: string; value: string }
  | { kind: "navigate"; url: string }
  | { kind: "snapshot" }
  | { kind: "wait"; ms: number }
  | { kind: "dismissModal"; modalId: string };

export type PortalActionResult =
  | { kind: "click" | "fill" | "select" | "navigate" | "wait" | "dismissModal"; ok: boolean; message?: string }
  | { kind: "snapshot"; ok: true; snapshot: FieldSnapshot }
  | { kind: "snapshot"; ok: false; message: string };

export type RunPortalActionsInput = {
  connectUrl: string;
  actions: PortalAction[];
  visionEnabled?: boolean;
};

export type RunPortalActionsResult = {
  ok: boolean;
  finalUrl?: string;
  results: PortalActionResult[];
};

/**
 * Reconnects to a kept-alive Browserbase session and executes a list of
 * actions. The list-of-actions shape (rather than one-action-per-call) is a
 * deliberate cost optimization: each reconnect takes seconds, so batching
 * 5-20 actions per call keeps the agent loop responsive.
 */
export async function runPortalActions(
  input: RunPortalActionsInput,
): Promise<RunPortalActionsResult> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(input.connectUrl);

  try {
    const pages = browser.contexts()[0]?.pages() ?? [];
    const page = pages[0] ?? (await browser.newPage());
    const visionEnabled = input.visionEnabled === true;
    const results: PortalActionResult[] = [];

    for (const action of input.actions) {
      try {
        const r = await executeAction(page, action, visionEnabled);
        results.push(r);
      } catch (error) {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        results.push({ kind: action.kind, ok: false, message });
      }
    }

    return { ok: true, finalUrl: page.url(), results };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function executeAction(
  page: Page,
  action: PortalAction,
  visionEnabled: boolean,
): Promise<PortalActionResult> {
  switch (action.kind) {
    case "click": {
      await clickWithVisionFallback({
        page,
        pageId: action.pageId,
        elementId: action.elementId,
        timeoutMs: 10_000,
        visionEnabled,
      });
      return { kind: "click", ok: true };
    }
    case "fill": {
      const locator = selectElement(page, action.pageId, action.elementId);
      await locator.waitFor({ state: "visible", timeout: 10_000 });
      await fillByLocator(locator, action.value);
      return { kind: "fill", ok: true };
    }
    case "select": {
      const locator = selectElement(page, action.pageId, action.elementId);
      await locator.waitFor({ state: "visible", timeout: 10_000 });
      await locator
        .selectOption({ value: action.value })
        .catch(async () => locator.selectOption({ label: action.value }));
      return { kind: "select", ok: true };
    }
    case "navigate": {
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return { kind: "navigate", ok: true };
    }
    case "snapshot": {
      const snapshot = await snapshotPageFields(page);
      return { kind: "snapshot", ok: true, snapshot };
    }
    case "wait": {
      await page.waitForTimeout(Math.min(Math.max(action.ms, 0), 30_000));
      return { kind: "wait", ok: true };
    }
    case "dismissModal": {
      if (action.modalId === "comunicadoInicial") {
        await dismissComunicadoInicial(page);
      } else if (action.modalId === "tourOverlay") {
        await dismissTourOverlay(page);
      } else if (action.modalId === "cookieBanner") {
        await acceptAllCookies(page, visionEnabled);
      } else if (action.modalId === "supportTerms") {
        await acceptSupportTerms(page);
      }
      return { kind: "dismissModal", ok: true };
    }
  }
}

/**
 * Closes a Browserbase session previously opened with `openPortalSession`.
 * Safe to call multiple times — Browserbase will return 204 even if already closed.
 */
export async function closePortalSession(input: { sessionId: string }): Promise<{ ok: boolean }> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) return { ok: false };

  const { default: Browserbase } = await import("@browserbasehq/sdk");
  const browserbase = new Browserbase({ apiKey });
  await browserbase.sessions
    .update(input.sessionId, { projectId, status: "REQUEST_RELEASE" })
    .catch(() => undefined);
  return { ok: true };
}
