import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useToastStore } from "../feedback/toastStore";
import { DEFAULT_APPEARANCE, useAppearanceStore } from "../ports/appearance";
import { READY_DELAY_MS, useAppearanceSync } from "./useAppearanceSync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ getAppearance: vi.fn(), patchAppearance: vi.fn() }));
vi.mock("@/data/core/request", () => ({
  coreRequest: (method: string, _path: string, body?: unknown) => (method === "GET" ? api.getAppearance() : api.patchAppearance(body)),
}));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const toasted = () => useToastStore.getState().queue.map((toast) => [toast.message, toast.variant]);

// custom CSS is installed by customCss.ts only: this id is its style element
const CSS_ID = "nuvo-custom-css";

function Harness() {
  useAppearanceSync();
  return null;
}

let root: Root;
const ready = vi.fn();
const applying = vi.fn();

/** jsdom has no layout: a guarded control is a box the test places and a hit test the test answers. */
function addGuard(hidden = false) {
  const el = document.createElement("button");
  el.setAttribute("data-nuvo-guard", "flex");
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 80, bottom: 30, width: 80, height: 30, toJSON: () => ({}) });
  if (hidden) el.style.display = "none";
  document.body.append(el);
  document.elementFromPoint = () => el;
  return el;
}

beforeEach(() => {
  useToastStore.setState({ queue: [] });
  vi.useFakeTimers();
  vi.clearAllMocks();
  (window as unknown as { nuvoShell: unknown }).nuvoShell = {
    getMainSettings: async () => ({ appearance: { safe: false, failedStarts: 0 } }),
    appearanceReady: ready,
    appearanceApplying: applying,
  };
  useAppearanceStore.setState({ saved: DEFAULT_APPEARANCE, loaded: false, safe: false, draft: null });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
  vi.useRealTimers();
});

async function mountWith(saved = DEFAULT_APPEARANCE) {
  api.getAppearance.mockResolvedValue(saved);
  api.patchAppearance.mockImplementation(async (patch) => ({ ...saved, ...patch }));
  await act(async () => root.render(<Harness />));
  await act(async () => undefined);
}

describe("useAppearanceSync", () => {
  it("applies saved fonts and CSS after the read and reports ready two seconds later", async () => {
    addGuard();
    await mountWith({
      ...DEFAULT_APPEARANCE,
      fonts: { ...DEFAULT_APPEARANCE.fonts, ui: { kind: "system", family: "Noto Sans" }, uiScale: 1.1 },
      customCss: { enabled: true, text: "a { color: red }" },
    });
    expect(document.documentElement.style.getPropertyValue("--n-font-ui")).toBe('"Noto Sans", var(--n-font-stack)');
    expect(document.getElementById(CSS_ID)?.textContent).toContain("a { color: red }");
    expect(ready).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(READY_DELAY_MS));
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("stored CSS that fails the check is never injected, is switched off and announced", async () => {
    addGuard();
    const text = "body { background: url(https://example.org/x) }";
    await mountWith({ ...DEFAULT_APPEARANCE, customCss: { enabled: true, text } });
    expect(document.getElementById(CSS_ID)).toBeNull();
    expect(api.patchAppearance).toHaveBeenCalledWith({ customCss: { enabled: false, text } });
    expect(toasted()).toContainEqual(["appearance.css.refused", "error"]);
  });

  it("CSS that hides a guarded control is switched off, saved off and announced", async () => {
    addGuard(true);
    await mountWith({ ...DEFAULT_APPEARANCE, customCss: { enabled: true, text: "[ data-nuvo-guard] { display: none }" } });
    expect(document.getElementById(CSS_ID)).toBeNull();
    expect(api.patchAppearance).toHaveBeenCalledWith({ customCss: { enabled: false, text: "[ data-nuvo-guard] { display: none }" } });
    expect(toasted()).toContainEqual(["appearance.css.guard_off", "error"]);
  });

  it("without a guarded control on the page the CSS waits, then applies when one mounts", async () => {
    await mountWith({ ...DEFAULT_APPEARANCE, customCss: { enabled: true, text: "a { color: red }" } });
    expect(document.getElementById(CSS_ID)).toBeNull();
    expect(api.patchAppearance).not.toHaveBeenCalled();
    await act(async () => {
      addGuard();
    });
    expect(document.getElementById(CSS_ID)).not.toBeNull();
  });

  it("safe mode applies no fonts and no CSS but keeps them saved", async () => {
    addGuard();
    (window as unknown as { nuvoShell: { getMainSettings: () => Promise<unknown> } }).nuvoShell.getMainSettings = async () => ({
      appearance: { safe: true, failedStarts: 2 },
    });
    const saved = {
      ...DEFAULT_APPEARANCE,
      fonts: { ...DEFAULT_APPEARANCE.fonts, ui: { kind: "system" as const, family: "Noto Sans" } },
      customCss: { enabled: true, text: "a { color: red }" },
    };
    await mountWith(saved);
    expect(document.documentElement.style.getPropertyValue("--n-font-ui")).toBe("");
    expect(document.getElementById(CSS_ID)).toBeNull();
    expect(useAppearanceStore.getState().saved).toEqual(saved);
  });

  it("a locked library sends no ready; the unlock read applies the look, then reports", async () => {
    api.getAppearance.mockRejectedValueOnce(new Error("locked"));
    api.patchAppearance.mockImplementation(async (patch) => ({ ...DEFAULT_APPEARANCE, ...patch }));
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTime(READY_DELAY_MS * 3));
    expect(applying).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    api.getAppearance.mockResolvedValue(DEFAULT_APPEARANCE);
    await act(async () => {
      window.dispatchEvent(new Event("library:changed"));
    });
    await act(async () => undefined);
    expect(applying).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(READY_DELAY_MS));
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
