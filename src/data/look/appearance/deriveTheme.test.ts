import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "@/data/color/contrast";
import { rgbToHsl } from "@/data/color/hsl";
import { PRESETS } from "../presets";
import { blockingModes, contrastReport, deriveRoles, fixContrast, focusRing, themeFromPreset, themeTokens } from "./deriveTheme";
import { ROLE_KEYS, normalizeColour, validateTheme, type NuvoTheme, type ThemeRoles } from "./themeSchema";
import { SAMPLE } from "./sampleTheme";

const theme = (roles: Partial<ThemeRoles>): NuvoTheme =>
  (validateTheme({ ...SAMPLE, modes: { light: { ...SAMPLE.modes.light, ...roles } } }) as { value: NuvoTheme }).value;

/** Deterministic pseudo-random fields, so a failure reproduces. */
function fields(count: number): string[] {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from(
    { length: count },
    () =>
      `#${[next(), next(), next()]
        .map((c) =>
          Math.floor(c * 256)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`,
  );
}

describe("derive", () => {
  it("smart start gives nine valid roles with readable ink for 20 random fields", () => {
    for (const field of fields(20)) {
      for (const mode of ["light", "dark"] as const) {
        const roles = deriveRoles(field, "#c2456b", mode);
        for (const key of ROLE_KEYS) expect(normalizeColour(roles[key]), `${field} ${key}`).not.toBeNull();
        expect(contrastRatio(roles.ink, roles.field), field).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(roles.accent, roles.field), field).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("Fix for me passes, changes lightness only and is idempotent", () => {
    const fixed = fixContrast("#8a8f99", "#9aa0aa", 4.5);
    expect(contrastRatio(fixed, "#9aa0aa")).toBeGreaterThanOrEqual(4.5);
    const [h1, s1] = rgbToHsl(0x8a, 0x8f, 0x99);
    const { r, g, b } = parseColor(fixed);
    const [h2, s2] = rgbToHsl(r, g, b);
    // hue is in degrees; an 8-bit grey-blue can only keep it within a few degrees
    expect(Math.abs(h2 - h1)).toBeLessThan(3);
    expect(s2).toBeCloseTo(s1, 1);
    expect(fixContrast(fixed, "#9aa0aa", 4.5)).toBe(fixed);
    const translucent = fixContrast("rgba(150, 150, 150, 0.7)", "#ffffff", 4.5);
    expect(translucent).toMatch(/^rgba\(\d+, \d+, \d+, 0\.7\)$/);
    expect(contrastRatio(translucent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("Save is blocked only under 1.5:1; 1.6:1 and 3.2:1 only warn", () => {
    expect(blockingModes(theme({ ink: "#f0eceb" }))).toEqual(["light"]);
    for (const ink of ["#c9bfbd", "#8f8583"]) {
      const t = theme({ ink, ink2: ink, ink3: ink });
      expect(blockingModes(t)).toEqual([]);
      expect(contrastReport(t.modes.light!).find((line) => line.role === "ink")?.pass).toBe(false);
    }
    const ratios = ["#f0eceb", "#c9bfbd", "#8f8583"].map((ink) => contrastRatio(ink, SAMPLE.modes.light.field));
    expect(ratios[0]).toBeLessThan(1.5);
    expect(ratios[1]).toBeGreaterThan(1.5);
    expect(ratios[2]).toBeGreaterThan(3);
    expect(ratios[2]).toBeLessThan(4.5);
  });

  it("A11-01 an accent under 3:1 on the field gives the ink focus ring", () => {
    const pale = theme({ accent: "#f3e6ea" });
    expect(focusRing(pale.modes.light!)).toBe(pale.modes.light!.ink);
    expect(themeTokens(pale, "light")["n-ring"]).toBe(pale.modes.light!.ink);
    expect(focusRing(SAMPLE.modes.light)).toBe(SAMPLE.modes.light.accent);
  });

  it("tokens are the ten --n-* names, from the theme's own roles", () => {
    const tokens = themeTokens(theme({}), "light");
    expect(Object.keys(tokens).sort()).toEqual(["n-accent", "n-deep", "n-field", "n-hair", "n-ink", "n-ink-2", "n-ink-3", "n-raised", "n-ring", "n-tint"]);
    expect(tokens["n-field"]).toBe("#faf6f5");
    expect(tokens["n-ink"]).toBe("#2a1f22");
    expect(tokens["n-accent"]).toBe("#c2456b");
    expect(tokens["n-ink-2"]).toBe("rgba(42,31,34,0.7)");
    expect(tokens["n-ink-3"]).toBe("rgba(42,31,34,0.62)");
  });

  it("every built-in preset becomes a valid theme that renders its own tokens", () => {
    for (const preset of PRESETS) {
      const theme = themeFromPreset(preset, preset.id, `copy-${preset.id}`);
      expect(validateTheme(theme), preset.id).toEqual({ ok: true, value: theme });
      for (const mode of preset.modes) {
        const tokens = themeTokens(theme, mode);
        for (const name of ["n-field", "n-deep", "n-raised", "n-ink", "n-accent"] as const) {
          expect(tokens[name].replace(/\s/g, ""), `${preset.id} ${mode} ${name}`).toBe(preset.tokens[mode]![name].replace(/\s/g, ""));
        }
      }
    }
  });
});
