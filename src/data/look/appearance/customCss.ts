import { sanitizeCss } from "./cssSanitizer";

const STYLE_ID = "nuvo-custom-css";
const GUARD_SHEET_ID = "nuvo-guard-sheet";
// Controls custom CSS must never hide carry data-nuvo-guard="<display type>"
const GUARD = "[data-nuvo-guard]";

/** The attribute carries the control's own display type; `revert` would turn flex controls into inline-block. */
const GUARD_DISPLAYS = ["flex", "inline-flex", "block", "grid"];
const GUARD_DISPLAY_RULES = GUARD_DISPLAYS.map((type) => `  ${GUARD}[data-nuvo-guard="${type}"] { display: ${type} !important; }`).join("\n");

// Declared first: important rules in the earliest layer beat important rules of later layers
const GUARD_SHEET = `@layer nuvo-guard, nuvo-custom;
@layer nuvo-guard {
  ${GUARD} {
    visibility: visible !important;
    opacity: 1 !important;
    content-visibility: visible !important;
    pointer-events: auto !important;
    clip-path: none !important;
    filter: none !important;
  }
${GUARD_DISPLAY_RULES}
}`;

// Guards under an open app dialog skip the hit test: CSS cannot open one, closing re-checks
export function guardsReachable(doc: Document, view: Window): boolean {
  const guards = [...doc.querySelectorAll(GUARD)];
  const dialogOpen = doc.querySelector('[aria-modal="true"]') !== null;
  return (
    guards.length > 0 &&
    guards.every((el) => {
      const style = view.getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility !== "visible" || Number.parseFloat(style.opacity || "1") <= 0.5) return false;
      if (box.width <= 0 || box.height <= 0) return false;
      if (dialogOpen) return true;
      const top = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top !== null && el.contains(top);
    })
  );
}

export type ApplyResult = { ok: true } | { ok: false; reason: "sanitizer" | "hid_control" | "no_guard" };

// Sanitized again at apply time: a stored sheet is not trusted either
export function applyCustomCss(doc: Document, view: Window, css: string): ApplyResult {
  removeCustomCss(doc);
  const checked = sanitizeCss(css);
  if (!checked.ok) return { ok: false, reason: "sanitizer" };
  if (!doc.querySelector(GUARD)) return { ok: false, reason: "no_guard" };
  let guardSheet = doc.getElementById(GUARD_SHEET_ID);
  if (!guardSheet) {
    guardSheet = doc.createElement("style");
    guardSheet.id = GUARD_SHEET_ID;
    guardSheet.textContent = GUARD_SHEET;
  }
  doc.head.prepend(guardSheet);
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  // the sanitizer has proved the braces balance, so the sheet cannot close this wrapper
  style.textContent = `@layer nuvo-custom {\n${checked.css}\n}`;
  doc.head.append(style);
  if (guardsReachable(doc, view)) return { ok: true };
  removeCustomCss(doc);
  return { ok: false, reason: "hid_control" };
}

export function removeCustomCss(doc: Document): void {
  doc.getElementById(STYLE_ID)?.remove();
  doc.getElementById(GUARD_SHEET_ID)?.remove();
}

const RECHECK_MS = [2000, 10000];
const RECHECK_DEBOUNCE_MS = 200;

function mediaQueries(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(/@media([^{]+)\{/gi)) found.add(match[1].trim());
  return [...found].slice(0, 16);
}

export function watchCustomCss(doc: Document, view: Window, css: string, onDrop: (reason: "sanitizer" | "hid_control") => void): () => void {
  const cleanups: Array<() => void> = [];
  let stopped = false;
  const stop = () => {
    stopped = true;
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
    removeCustomCss(doc);
  };
  const drop = (reason: "sanitizer" | "hid_control") => {
    if (stopped) return;
    stop();
    onDrop(reason);
  };
  const recheck = () => {
    if (!stopped && doc.querySelector(GUARD) && !guardsReachable(doc, view)) drop("hid_control");
  };
  const start = (): boolean => {
    const result = applyCustomCss(doc, view, css);
    if (!result.ok) {
      if (result.reason === "no_guard") return false;
      drop(result.reason);
      return true;
    }
    view.addEventListener("resize", recheck);
    cleanups.push(() => view.removeEventListener("resize", recheck));
    for (const query of mediaQueries(css)) {
      const list = view.matchMedia?.(query);
      list?.addEventListener("change", recheck);
      if (list) cleanups.push(() => list.removeEventListener("change", recheck));
    }
    // later screens mount their own guards, so the check never stops: DOM changes and route changes re-run it, debounced
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        recheck();
      }, RECHECK_DEBOUNCE_MS);
    };
    const observer = new MutationObserver(soon);
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-nuvo-guard"] });
    view.addEventListener("popstate", soon);
    view.addEventListener("hashchange", soon);
    cleanups.push(() => {
      observer.disconnect();
      view.removeEventListener("popstate", soon);
      view.removeEventListener("hashchange", soon);
      clearTimeout(pending);
    });
    for (const ms of RECHECK_MS) {
      const timer = setTimeout(recheck, ms);
      cleanups.push(() => clearTimeout(timer));
    }
    return true;
  };

  if (!start()) {
    const observer = new MutationObserver(() => {
      if (!stopped && doc.querySelector(GUARD)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    cleanups.push(() => observer.disconnect());
  }
  return stop;
}
