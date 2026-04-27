import type { Browser, Page } from "playwright-core";

export type OrizonTissFile = {
  fileName: string;
  bytes: Buffer;
  contentType: string;
};

export type OrizonLoginInput = {
  username: string;
  password: string;
  jobId?: string;
  tissFile?: OrizonTissFile;
  onProgress?: (event: OrizonProgressEvent) => Promise<void> | void;
};

export type OrizonProgressEvent =
  | { stage: "popup_dismissed" }
  | { stage: "upload_page_opened" }
  | { stage: "file_uploaded" }
  | { stage: "batches_selected" }
  | { stage: "submitted" }
  | { stage: "confirmed" };

export type OrizonLoginResult = {
  ok: boolean;
  mode: "browserbase";
  finalUrl?: string;
  sessionId?: string;
  debugUrl?: string;
  message: string;
  submitted?: boolean;
};

const loginUrl =
  "https://sso-fature.orizon.com.br/auth/realms/orizon-dativa/protocol/openid-connect/auth?client_id=fature_client&response_type=code&scope=openid&redirect_uri=https://sso-auth-codeflow-fature-apicast-production.api.ocppr.orizon.com.br/sso/token?user_key=32efd36b405a07b8c0e6c6cb9c582047";

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
      finalUrl: loginUrl,
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
      purpose: input.tissFile ? "submit_tiss" : "login",
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

async function performFlow(
  browser: Browser,
  input: OrizonLoginInput,
): Promise<Omit<OrizonLoginResult, "mode">> {
  const page = await browser.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('input[name="username"], input[type="text"]').first().fill(input.username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(input.password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);

    const hasPasswordField = await page.locator('input[type="password"]').count();
    if (hasPasswordField > 0) {
      return {
        ok: false,
        finalUrl: page.url(),
        message: "Login Orizon nao avancou; revise credenciais ou MFA.",
      };
    }

    if (!input.tissFile) {
      return {
        ok: true,
        finalUrl: page.url(),
        message: "Login Orizon concluido.",
      };
    }

    await dismissPopups(page);
    await input.onProgress?.({ stage: "popup_dismissed" });

    await openUploadPage(page);
    await input.onProgress?.({ stage: "upload_page_opened" });

    await uploadTissBatch(page, input.tissFile);
    await input.onProgress?.({ stage: "file_uploaded" });

    await selectAllBatches(page);
    await input.onProgress?.({ stage: "batches_selected" });

    await submitBatches(page);
    await input.onProgress?.({ stage: "submitted" });

    await confirmSubmission(page);
    await input.onProgress?.({ stage: "confirmed" });

    return {
      ok: true,
      finalUrl: page.url(),
      message: "Lote TISS enviado para a Orizon.",
      submitted: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha durante envio TISS.";
    return {
      ok: false,
      finalUrl: page.url(),
      message,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function dismissPopups(page: Page) {
  // Best-effort: any modal that exposes a "Fechar" button gets clicked away.
  const candidates = [
    page.getByRole("button", { name: /^fechar$/i }),
    page.getByRole("link", { name: /^fechar$/i }),
    page.locator('button:has-text("Fechar")'),
  ];
  for (const locator of candidates) {
    try {
      const first = locator.first();
      if (await first.isVisible({ timeout: 1500 }).catch(() => false)) {
        await first.click({ timeout: 2000 });
        await page.waitForTimeout(400);
      }
    } catch {
      // Ignore — popups are optional.
    }
  }
}

async function openUploadPage(page: Page) {
  const link = page
    .getByRole("link", { name: /enviar xml tiss/i })
    .or(page.getByRole("button", { name: /enviar xml tiss/i }))
    .or(page.locator('a:has-text("Enviar XML TISS"), button:has-text("Enviar XML TISS")'))
    .first();

  await link.waitFor({ state: "visible", timeout: 30_000 });
  await link.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page
    .getByText(/selecione um ou mais arquivos compactados/i)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function uploadTissBatch(page: Page, file: OrizonTissFile) {
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  await fileInput.setInputFiles({
    name: file.fileName,
    mimeType: file.contentType || "application/zip",
    buffer: file.bytes,
  });

  // Wait for the validation row to appear (file name visible in the list area).
  await page
    .getByText(file.fileName, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

async function selectAllBatches(page: Page) {
  // First checkbox in the batches list = column-header select-all.
  const checkbox = page.locator('input[type="checkbox"]').first();
  await checkbox.waitFor({ state: "visible", timeout: 15_000 });
  if (!(await checkbox.isChecked().catch(() => false))) {
    await checkbox.check({ timeout: 5_000 }).catch(async () => {
      // Some UIs hide the native input behind a label; click instead.
      await checkbox.click({ force: true, timeout: 5_000 });
    });
  }
}

async function submitBatches(page: Page) {
  const enviar = page
    .getByRole("button", { name: /^enviar$/i })
    .or(page.locator('button:has-text("Enviar"):not(:has-text("arquivos")):not(:has-text("XML"))'))
    .first();
  await enviar.waitFor({ state: "visible", timeout: 15_000 });
  await enviar.click();
}

async function confirmSubmission(page: Page) {
  const confirm = page
    .getByRole("button", { name: /enviar arquivos v[aá]lidos/i })
    .or(page.locator('button:has-text("Enviar arquivos válidos")'))
    .or(page.locator('button:has-text("Enviar arquivos validos")'))
    .first();
  await confirm.waitFor({ state: "visible", timeout: 30_000 });
  await confirm.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}
