import { describe, expect, it } from "vitest";
import { applyPresetTokens, applyTokens } from "./apply";
import { PRESETS, PRESET_IDS, getPreset, presetIconSvg, resolvePresetMode } from "./presets";

describe("presets", () => {
  it("has the nine presets in order, each mode with the same token names", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual(PRESET_IDS);
    expect(PRESET_IDS).toHaveLength(9);
    const names = (tokens: object) => Object.keys(tokens).sort().join();
    const reference = names(getPreset("nuvo").tokens.dark ?? getPreset("nuvo").tokens.light!);
    for (const preset of PRESETS) {
      expect(preset.modes).toEqual(["light", "dark"]);
      for (const mode of preset.modes) expect(names(preset.tokens[mode]!)).toBe(reference);
    }
    expect(reference).toContain("n-accent");
  });

  it("an unknown id falls back to nuvo; a missing mode resolves to the preset's own", () => {
    expect(getPreset("gone").id).toBe("nuvo");
    expect(resolvePresetMode({ ...getPreset("ink"), modes: ["dark"] }, "light")).toBe("dark");
    expect(resolvePresetMode(getPreset("nuvo"), "light")).toBe("light");
  });

  it("every preset has its own icon per mode, a light tile in light mode and a dark one in dark", () => {
    const icons = new Set<string>();
    const luma = (hex: string) => [0, 2, 4].reduce((sum, at, i) => sum + parseInt(hex.slice(1 + at, 3 + at), 16) * [0.2126, 0.7152, 0.0722][i], 0);
    for (const preset of PRESETS) {
      for (const mode of preset.modes) {
        const svg = presetIconSvg(preset.id, mode);
        expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
        const tileTop = /id="bg"[^>]*><stop offset="0" stop-color="(#[0-9a-fA-F]{6})"/.exec(svg)![1];
        expect(luma(tileTop) > 128).toBe(mode === "light");
        icons.add(svg);
      }
    }
    expect(icons.size).toBe(PRESETS.length * 2);
  });

  it("applying sets the tokens and drops stale --n-* ones", () => {
    const root = document.createElement("div");
    root.style.setProperty("--n-stale", "1");
    root.style.setProperty("--other", "keep");
    applyTokens(root, "test", { "n-ink": "#000" });
    expect(root.style.getPropertyValue("--n-ink")).toBe("#000");
    expect(root.style.getPropertyValue("--n-stale")).toBe("");
    expect(root.style.getPropertyValue("--other")).toBe("keep");
    const preset = getPreset("nuvo");
    applyPresetTokens(root, preset, preset.modes[0]);
    expect(root.style.getPropertyValue("--n-accent")).toBe(preset.tokens[preset.modes[0]]!["n-accent"]);
    expect(root.style.getPropertyValue("--n-ink")).not.toBe("#000");
  });

  it("the older colour names in Nuvo's styles follow the --n-* tokens", () => {
    const root = document.createElement("div");
    applyTokens(root, "test", { "n-ink": "#111" });
    expect(root.style.getPropertyValue("--text-primary")).toBe("var(--n-ink)");
    expect(root.style.getPropertyValue("--bg-glass")).toContain("var(--n-field)");
    expect(root.style.getPropertyValue("--border-toolbox-divider")).toBe("var(--n-hair)");
  });

  it("the accent keeps 4.5:1 over the field and raised surfaces, so it can carry a field-coloured label", () => {
    const failures: string[] = [];
    for (const preset of PRESETS) {
      for (const mode of preset.modes) {
        const tokens = preset.tokens[mode]!;
        for (const surface of ["n-field", "n-raised"]) {
          const ratio = contrast(parseColor(tokens["n-accent"]), parseColor(tokens[surface]));
          if (ratio < 4.5) failures.push(`${preset.id} ${mode}: accent on ${surface} is ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("no two presets share a field colour: every pair stays apart in OKLab in both modes", () => {
    const close: string[] = [];
    for (const mode of ["light", "dark"] as const) {
      for (const [i, a] of PRESETS.entries()) {
        for (const b of PRESETS.slice(i + 1)) {
          const gap = oklabDistance(parseColor(a.tokens[mode]!["n-field"]), parseColor(b.tokens[mode]!["n-field"]));
          if (gap < 0.024) close.push(`${a.id} and ${b.id} ${mode}: ${gap.toFixed(3)}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("text roles keep 4.5:1 over every surface of every preset and mode", () => {
    const failures: string[] = [];
    for (const preset of PRESETS) {
      for (const mode of preset.modes) {
        const tokens = preset.tokens[mode]!;
        for (const surface of ["n-field", "n-deep", "n-raised"]) {
          const back = parseColor(tokens[surface]);
          for (const text of ["n-ink", "n-ink-2", "n-ink-3"]) {
            const ratio = contrast(over(parseColor(tokens[text]), back), back);
            if (ratio < 4.5) failures.push(`${preset.id} ${mode}: ${text} on ${surface} is ${ratio.toFixed(2)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (!rgb) throw new Error(`unreadable colour ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
}

function over(front: Rgba, back: Rgba): Rgba {
  const alpha = front[3];
  return [0, 1, 2].map((i) => front[i] * alpha + back[i] * (1 - alpha)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function oklab([r, g, b]: Rgba): number[] {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabDistance(a: Rgba, b: Rgba): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
