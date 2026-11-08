// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { afterEach as after, beforeEach, vi } from "vitest";
import { applyCustomCss, guardsReachable, watchCustomCss } from "./customCss";

/** jsdom has no layout: a guard is a box the test places and a hit test the test answers. */
function guard(box = { width: 100, height: 30 }) {
  const el = document.createElement("button");
  el.setAttribute("data-nuvo-guard", "flex");
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: box.width, bottom: box.height, ...box, toJSON: () => ({}) });
  document.body.append(el);
  return el;
}
/** A window whose listed members are replaced; the rest is the real one. */
const viewWith = (overrides: object) =>
  new Proxy(window, { get: (target, key) => (key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : bind(target, key)) });
const bind = (target: Window, key: PropertyKey) => {
  const value = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
};
const hits = (target: Element | null) => {
  document.elementFromPoint = () => target;
};

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("never-hide runtime check", () => {
  it("E2E-04 a visible, sized, top-most guard passes; no guard on the page fails closed", () => {
    expect(guardsReachable(document, window)).toBe(false);
    hits(guard());
    expect(guardsReachable(document, window)).toBe(true);
  });

  it("fails when a guard is hidden, transparent, empty or covered", () => {
    const el = guard();
    hits(el);
    el.style.display = "none";
    expect(guardsReachable(document, window)).toBe(false);
    el.style.display = "";
    el.style.opacity = "0.4";
    expect(guardsReachable(document, window)).toBe(false);
    el.style.opacity = "";
    el.style.visibility = "hidden";
    expect(guardsReachable(document, window)).toBe(false);
    el.style.visibility = "";
    hits(document.body);
    expect(guardsReachable(document, window)).toBe(false);
    const empty = guard({ width: 0, height: 0 });
    hits(empty);
    expect(guardsReachable(document, window)).toBe(false);
  });

  it("while an app dialog is open, guards it covers or scrolls away still pass; shown and sized are still checked", () => {
    const el = guard();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    hits(dialog);
    expect(guardsReachable(document, window)).toBe(true);
    el.style.display = "none";
    expect(guardsReachable(document, window)).toBe(false);
    el.style.display = "";
    dialog.remove();
    expect(guardsReachable(document, window)).toBe(false);
  });
});

describe("applying custom CSS", () => {
  it("refuses a sheet the sanitizer refuses, applies a good one", () => {
    hits(guard());
    expect(applyCustomCss(document, window, "a{background:url(x)}")).toEqual({ ok: false, reason: "sanitizer" });
    expect(document.getElementById("nuvo-custom-css")).toBeNull();
    expect(applyCustomCss(document, window, ".card{color:red}")).toEqual({ ok: true });
    expect(document.getElementById("nuvo-custom-css")?.textContent).toBe("@layer nuvo-custom {\n.card{color:red}\n}");
  });

  it("drops the sheet when it hides a guarded control", () => {
    hits(guard());
    // jsdom does not run cascade layers, so the computed style is reported by hand once the sheet is in
    const view = viewWith({
      getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: document.getElementById("nuvo-custom-css") ? "0.2" : "1" }),
    });
    const style = applyCustomCss(document, view, "button{opacity:.2}");
    expect(style).toEqual({ ok: false, reason: "hid_control" });
    expect(document.getElementById("nuvo-custom-css")).toBeNull();
  });
});

describe("cascade layers", () => {
  const bypasses = [
    "[ data-nuvo-guard]{display:none}",
    "[/**/data-nuvo-guard]{display:none}",
    "[*|data-nuvo-guard]{display:none}",
    ":root{--h:none}button{display:var(--h)}",
    "[data-nuvo-guard]{content-visibility:hidden}",
    "main{&{display:none}}",
  ];

  it.each(bypasses)("installs %s only inside the custom layer, behind a guard sheet declared first", (sheet) => {
    hits(guard());
    const result = applyCustomCss(document, window, sheet);
    // a sheet the static check already refuses never reaches the page
    if (!result.ok && result.reason === "sanitizer") return;
    const guardSheet = document.head.firstElementChild as HTMLStyleElement;
    expect(guardSheet.id).toBe("nuvo-guard-sheet");
    expect(guardSheet.textContent).toMatch(/^@layer nuvo-guard, nuvo-custom;/);
    for (const declaration of ["visibility:visible", "opacity:1", "content-visibility:visible", "pointer-events:auto"]) {
      expect(guardSheet.textContent!.replace(/\s+/g, "")).toContain(`${declaration}!important`);
    }
    const custom = document.getElementById("nuvo-custom-css");
    if (custom) {
      expect(custom.textContent).toBe(`@layer nuvo-custom {\n${sheet}\n}`);
      expect(document.head.lastElementChild).toBe(custom);
    }
  });

  it("a sheet that closes the wrapper early is refused, not trusted", () => {
    hits(guard());
    expect(applyCustomCss(document, window, "} [data-nuvo-guard]{display:none} @media all{")).toEqual({ ok: false, reason: "sanitizer" });
    expect(document.getElementById("nuvo-custom-css")).toBeNull();
  });

  it("the guard restores the display type the control carries, never revert", () => {
    hits(guard());
    applyCustomCss(document, window, ".card{color:red}");
    const text = document.getElementById("nuvo-guard-sheet")!.textContent!.replace(/\s+/g, "");
    for (const type of ["flex", "inline-flex", "block", "grid"]) {
      expect(text).toContain(`[data-nuvo-guard="${type}"]{display:${type}!important`);
    }
    expect(text).not.toContain("revert");
  });

  it("no guard on the page: nothing is installed", () => {
    expect(applyCustomCss(document, window, ".card{color:red}")).toEqual({ ok: false, reason: "no_guard" });
    expect(document.getElementById("nuvo-custom-css")).toBeNull();
  });
});

describe("watching custom CSS", () => {
  beforeEach(() => vi.useFakeTimers());
  after(() => vi.useRealTimers());

  it("waits for a guard to mount, then applies", async () => {
    const dropped = vi.fn();
    const stop = watchCustomCss(document, window, ".card{color:red}", dropped);
    expect(document.getElementById("nuvo-custom-css")).toBeNull();
    hits(guard());
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("nuvo-custom-css")).not.toBeNull();
    expect(dropped).not.toHaveBeenCalled();
    stop();
  });

  it("re-checks on resize and 2 s and 10 s after applying, and drops a sheet that hides a guard later", () => {
    const dropped = vi.fn();
    const el = guard();
    hits(el);
    const stop = watchCustomCss(document, window, ".card{color:red}", dropped);
    expect(document.getElementById("nuvo-custom-css")).not.toBeNull();
    el.style.opacity = "0.2";
    window.dispatchEvent(new Event("resize"));
    expect(dropped).toHaveBeenCalledWith("hid_control");
    expect(document.getElementById("nuvo-custom-css")).toBeNull();
    stop();

    const later = guard();
    hits(later);
    const dropped2 = vi.fn();
    const stop2 = watchCustomCss(document, window, ".card{color:red}", dropped2);
    later.style.display = "none";
    vi.advanceTimersByTime(2000);
    expect(dropped2).toHaveBeenCalledTimes(1);
    stop2();

    const third = guard();
    hits(third);
    const dropped3 = vi.fn();
    const stop3 = watchCustomCss(document, window, ".card{color:red}", dropped3);
    vi.advanceTimersByTime(2000);
    third.style.visibility = "hidden";
    vi.advanceTimersByTime(8000);
    expect(dropped3).toHaveBeenCalledWith("hid_control");
    stop3();
  });

  it("keeps re-checking after 10 s: DOM changes and route changes re-run the guard check", async () => {
    const el = guard();
    hits(el);
    const dropped = vi.fn();
    const stop = watchCustomCss(document, window, ".card{color:red}", dropped);
    await vi.advanceTimersByTimeAsync(60000);
    expect(dropped).not.toHaveBeenCalled();
    // a screen mounts a second guard that the sheet hides
    const second = guard();
    second.style.opacity = "0.2";
    await vi.advanceTimersByTimeAsync(1000);
    expect(dropped).toHaveBeenCalledWith("hid_control");
    stop();

    const third = guard();
    hits(third);
    const dropped2 = vi.fn();
    const stop2 = watchCustomCss(document, window, ".card{color:red}", dropped2);
    await vi.advanceTimersByTimeAsync(60000);
    third.style.display = "none";
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(dropped2).toHaveBeenCalledWith("hid_control");
    stop2();
  });

  it("re-checks when a media query of the sheet changes", () => {
    const listeners: Array<() => void> = [];
    const view = viewWith({
      matchMedia: () => ({ addEventListener: (_: string, cb: () => void) => listeners.push(cb), removeEventListener: () => undefined }),
    });
    const el = guard();
    hits(el);
    const dropped = vi.fn();
    const stop = watchCustomCss(document, view, "@media (min-width: 900px){.card{color:red}}", dropped);
    expect(listeners.length).toBeGreaterThan(0);
    el.style.opacity = "0.2";
    listeners[0]();
    expect(dropped).toHaveBeenCalledWith("hid_control");
    stop();
  });

  it("a refused sheet is reported at once and a stopped watch stays quiet", () => {
    const dropped = vi.fn();
    watchCustomCss(document, window, "a{background:url(x)}", dropped);
    expect(dropped).toHaveBeenCalledWith("sanitizer");
    const el = guard();
    hits(el);
    const quiet = vi.fn();
    watchCustomCss(document, window, ".card{color:red}", quiet)();
    el.style.opacity = "0.2";
    vi.advanceTimersByTime(10000);
    expect(quiet).not.toHaveBeenCalled();
  });
});
