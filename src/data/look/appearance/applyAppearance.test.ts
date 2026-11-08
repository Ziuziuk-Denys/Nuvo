// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, type NuvoTheme } from "@/data/look/appearanceContracts";
import { applyFontSettings, cssFamily, dropUserFonts, familyValue, loadUserFont } from "./applyAppearance";
import { activeTheme } from "./appearanceStore";
import { SAMPLE } from "./sampleTheme";

const id = "a".repeat(64);

describe("apply appearance", () => {
  it("quotes family names and always appends the default stack", () => {
    expect(cssFamily('A "B" \\C')).toBe('"A \\"B\\" \\\\C"');
    expect(familyValue({ kind: "system", family: "Noto Sans" }, new Set())).toBe('"Noto Sans", var(--n-font-stack)');
    expect(familyValue({ kind: "file", id }, new Set())).toBeNull();
    expect(familyValue({ kind: "file", id }, new Set([id]))).toBe('"nuvo-user-aaaaaaaa", var(--n-font-stack)');
    expect(familyValue({ kind: "default" }, new Set())).toBeNull();
  });

  it("writes fonts and sizes as custom properties and removes them for the defaults", () => {
    const root = document.createElement("div");
    applyFontSettings(root, { ui: { kind: "system", family: "Noto Sans" }, lyrics: { kind: "file", id }, uiScale: 1.1, lyricsScale: 0.8 }, new Set([id]));
    expect(root.style.getPropertyValue("--n-font-ui")).toBe('"Noto Sans", var(--n-font-stack)');
    expect(root.style.getPropertyValue("--font-inter")).toBe('"Noto Sans", var(--n-font-stack)');
    expect(root.style.getPropertyValue("--n-font-lyrics")).toBe('"nuvo-user-aaaaaaaa", var(--n-font-stack)');
    expect(root.style.getPropertyValue("--n-scale")).toBe("1.1");
    expect(root.style.getPropertyValue("--n-lyrics-scale")).toBe("0.8");
    applyFontSettings(root, DEFAULT_APPEARANCE.fonts, new Set());
    expect(root.style.cssText).toBe("");
  });

  it("the draft wins, safe mode hides the saved theme, built-in ids give none", () => {
    const theme = SAMPLE as unknown as NuvoTheme;
    const saved = { ...DEFAULT_APPEARANCE, themes: [theme], active: { presetId: `custom:${theme.id}` } };
    expect(activeTheme({ saved, safe: false, draft: null })).toBe(theme);
    expect(activeTheme({ saved, safe: true, draft: null })).toBeNull();
    const draft = { ...theme, id: "draft" };
    expect(activeTheme({ saved, safe: true, draft })).toBe(draft);
    expect(activeTheme({ saved: { ...saved, active: { presetId: "vinyl" } }, safe: false, draft: null })).toBeNull();
    expect(activeTheme({ saved: { ...saved, active: { presetId: "custom:gone" } }, safe: false, draft: null })).toBeNull();
  });
});

describe("user font faces", () => {
  it("faces of fonts that are no longer chosen leave document.fonts; a face still chosen is loaded once", async () => {
    const set = new Set<object>();
    class FakeFace {
      constructor(public family: string) {}
      load = async () => this;
    }
    vi.stubGlobal("FontFace", FakeFace);
    Object.defineProperty(document, "fonts", { configurable: true, value: { add: (f: object) => set.add(f), delete: (f: object) => set.delete(f) } });
    const entry = (id: string) => ({ id, family: "X", format: "ttf" as const, bytes: 1, addedAt: 1 });
    expect(await loadUserFont(entry("aaaaaaaa11"))).toBe(true);
    expect(await loadUserFont(entry("aaaaaaaa11"))).toBe(true);
    expect(await loadUserFont(entry("bbbbbbbb22"))).toBe(true);
    expect(set.size).toBe(2);
    dropUserFonts(new Set(["bbbbbbbb22"]));
    expect(set.size).toBe(1);
    dropUserFonts(new Set());
    expect(set.size).toBe(0);
    vi.unstubAllGlobals();
  });
});
