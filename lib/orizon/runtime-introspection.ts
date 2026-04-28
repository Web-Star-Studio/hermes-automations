import type { Page } from "playwright-core";

/**
 * Runtime introspection of the current page's interactive form fields.
 * Used as a fallback when the static portal map doesn't cover the page
 * (e.g., deep-step fields of guides whose later steps the portal blocks
 * us from walking statically) or for ad-hoc modals (procedure entry).
 */

export type FieldKind =
  | "text"
  | "select"
  | "checkbox"
  | "radio"
  | "date"
  | "textarea"
  | "number"
  | "unknown";

export type IntrospectedField = {
  /** DOM id when present. */
  id: string | null;
  /** name attribute when present. */
  name: string | null;
  kind: FieldKind;
  /** Visible label nearby (for: id, ancestor div's label, or aria-label). */
  label: string;
  placeholder: string | null;
  /** Angular ng-model path. */
  ngModel: string | null;
  required: boolean;
  disabled: boolean;
  /** Selectable when no other anchor — generated from path/index. */
  cssPath: string;
  /** Current value (or label of selected option) for visibility into pre-filled fields. */
  currentValue: string | null;
  /** For select fields: list of option values + display text. */
  options: Array<{ value: string; text: string }> | null;
};

export type IntrospectedButton = {
  id: string | null;
  text: string;
  ngClick: string | null;
  classes: string;
};

export type FieldSnapshot = {
  url: string;
  /** Visible H1/H2/H3/section headings, useful for context. */
  headings: string[];
  fields: IntrospectedField[];
  buttons: IntrospectedButton[];
};

/**
 * Snapshot the visible form controls in the current viewport / page area.
 * Skips header / sidebar / tour overlays so the snapshot represents the
 * actual form the agent should drive.
 */
export async function snapshotPageFields(
  page: Page,
  options: { scopeSelector?: string } = {},
): Promise<FieldSnapshot> {
  const scope = options.scopeSelector ?? null;

  return await page.evaluate((scopeArg: string | null) => {
    const root = scopeArg ? document.querySelector(scopeArg) ?? document.body : document.body;

    function visible(el: Element): boolean {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = window.getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
    }

    function inUiChrome(el: Element): boolean {
      return Boolean(
        el.closest(
          'header, nav.main, aside.sidebar, #wraperHeader, .sidebar, .menu-lateral, [class*="tour-"][class*="-element"]',
        ),
      );
    }

    function classifyKind(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FieldKind {
      if (el.tagName === "SELECT") return "select";
      if (el.tagName === "TEXTAREA") return "textarea";
      const input = el as HTMLInputElement;
      switch (input.type) {
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "date":
        case "datetime-local":
          return "date";
        case "number":
          return "number";
        case "text":
        case "tel":
        case "email":
        case "url":
        case "search":
        case "password":
          return "text";
        default:
          return "unknown";
      }
    }

    function findLabel(el: Element): string {
      const id = (el as HTMLElement).id;
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl?.textContent) return lbl.textContent.trim();
      }
      const ariaLabel = (el as HTMLElement).getAttribute("aria-label");
      if (ariaLabel) return ariaLabel.trim();
      const ariaLabelledBy = (el as HTMLElement).getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const ref = document.getElementById(ariaLabelledBy);
        if (ref?.textContent) return ref.textContent.trim();
      }
      // Walk up to the nearest .form-group / div / fieldset and look for a label.
      let cur: Element | null = el.parentElement;
      let depth = 0;
      while (cur && depth < 4) {
        const lbl = cur.querySelector(":scope > label, :scope > .control-label, :scope > .label-text");
        if (lbl?.textContent) return lbl.textContent.trim();
        cur = cur.parentElement;
        depth++;
      }
      return "";
    }

    function buildCssPath(el: Element): string {
      const id = (el as HTMLElement).id;
      if (id) return `#${CSS.escape(id)}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
        const tag = cur.tagName.toLowerCase();
        const sib = cur.parentElement
          ? Array.from(cur.parentElement.children).filter((c) => c.tagName === cur!.tagName)
          : [cur];
        const idx = sib.length > 1 ? `:nth-of-type(${sib.indexOf(cur) + 1})` : "";
        parts.unshift(`${tag}${idx}`);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    }

    function currentValue(
      el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    ): string | null {
      if (el.tagName === "SELECT") {
        const sel = el as HTMLSelectElement;
        return sel.options[sel.selectedIndex]?.text?.trim() ?? null;
      }
      const input = el as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio") {
        return String(input.checked);
      }
      return input.value || null;
    }

    function getOptions(el: HTMLSelectElement): Array<{ value: string; text: string }> {
      return Array.from(el.options).map((o) => ({ value: o.value, text: (o.text || "").trim() }));
    }

    const fields: IntrospectedField[] = [];
    for (const el of Array.from(root.querySelectorAll("input, select, textarea"))) {
      const node = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!visible(node)) continue;
      if (inUiChrome(node)) continue;
      if (node instanceof HTMLInputElement && node.type === "hidden") continue;
      // Skip the ubiquitous "maisutilizados" radios in the global menu.
      if ((node as HTMLInputElement).name === "maisutilizados") continue;

      const isSelect = node.tagName === "SELECT";
      fields.push({
        id: node.id || null,
        name: (node as HTMLInputElement).name || null,
        kind: classifyKind(node),
        label: findLabel(node),
        placeholder: (node as HTMLInputElement).placeholder || null,
        ngModel: node.getAttribute("ng-model"),
        required: node.hasAttribute("required") || node.getAttribute("ng-required") === "true",
        disabled: (node as HTMLInputElement).disabled === true,
        cssPath: buildCssPath(node),
        currentValue: currentValue(node),
        options: isSelect ? getOptions(node as HTMLSelectElement) : null,
      });
    }

    const buttons: IntrospectedButton[] = [];
    for (const el of Array.from(root.querySelectorAll("button, a.btn, a.btn-radius"))) {
      const node = el as HTMLElement;
      if (!visible(node)) continue;
      if (inUiChrome(node)) continue;
      buttons.push({
        id: node.id || null,
        text: (node.textContent || "").replace(/\s+/g, " ").trim(),
        ngClick: node.getAttribute("ng-click"),
        classes: node.className.substring(0, 100),
      });
    }

    const headings: string[] = [];
    for (const el of Array.from(root.querySelectorAll("h1, h2, h3, h4, .section-title"))) {
      if (!visible(el)) continue;
      if (inUiChrome(el)) continue;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length > 0 && t.length < 120) headings.push(t);
    }

    return {
      url: window.location.href,
      headings,
      fields,
      buttons,
    };
  }, scope);
}

/**
 * Convenience: snapshot fields scoped to a Bootstrap modal currently open
 * (sets `body.modal-open`). Useful for the "adicionar Item" procedure modal.
 */
export async function snapshotOpenModalFields(page: Page): Promise<FieldSnapshot | null> {
  const hasModal = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.modal.in, [role="dialog"]:not([hidden])')).some(
      (el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      },
    );
  });
  if (!hasModal) return null;
  return snapshotPageFields(page, { scopeSelector: '.modal.in, [role="dialog"]' });
}
