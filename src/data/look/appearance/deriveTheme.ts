import { contrastRatio, luminance, parseColor, toHex } from "@/data/color/contrast";
import { hslToRgb, rgbToHsl } from "@/data/color/hsl";
import type { Preset, PresetMode, Tokens } from "../presets";
import { normalizeColour, rolesFor, type NuvoTheme, type RoleKey, type ThemeRoles } from "./themeSchema";

// Contrast targets: 4.5 (AA) for reading text, 3:1 for hints and the accent
export const TARGETS: Partial<Record<RoleKey, number>> = { ink: 4.5, ink2: 4.5, ink3: 3, accent: 3 };
// Owner's provisional threshold: below it ink on field or raised blocks Save, else warns
export const BLOCK_BELOW = 1.5;

const rgbOf = (colour: string) => {
  const { r, g, b } = parseColor(colour);
  return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
};

function withLightness(colour: string, l: number): string {
  const { r, g, b, a } = parseColor(colour);
  const [h, s] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(h, s, Math.min(1, Math.max(0, l)));
  return a === 1 ? toHex({ r: nr, g: ng, b: nb, a }) : `rgba(${nr}, ${ng}, ${nb}, ${a})`;
}

function lightnessOf(colour: string): number {
  const { r, g, b } = parseColor(colour);
  return rgbToHsl(r, g, b)[2];
}

function mix(a: string, b: string, amount: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return toHex({ r: x.r + (y.r - x.r) * amount, g: x.g + (y.g - x.g) * amount, b: x.b + (y.b - x.b) * amount, a: 1 });
}

export function fixContrast(foreground: string, background: string, target: number): string {
  if (contrastRatio(foreground, background) >= target) return foreground;
  const start = lightnessOf(foreground);
  const darker = luminance(parseColor(background)) > 0.18;
  for (let step = 1; step <= 100; step += 1) {
    const candidate = withLightness(foreground, start + (darker ? -step : step) / 100);
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  for (let step = 1; step <= 100; step += 1) {
    const candidate = withLightness(foreground, start + (darker ? step : -step) / 100);
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  return withLightness(foreground, darker ? 0 : 1);
}

export function deriveRoles(field: string, accent: string, mode: PresetMode): ThemeRoles {
  const base = toHex(parseColor(field));
  const lightInk = luminance(parseColor(base)) <= 0.18;
  const ink = fixContrast(mix(base, lightInk ? "#ffffff" : "#000000", lightInk ? 0.92 : 0.88), base, 4.5);
  const rgb = rgbOf(ink);
  const dark = mode === "dark";
  return {
    field: base,
    deep: mix(base, "#000000", dark ? 0.25 : 0.05),
    raised: dark ? mix(base, "#ffffff", 0.06) : mix(base, "#ffffff", 0.7),
    ink,
    ink2: `rgba(${rgb}, ${dark ? 0.72 : 0.7})`,
    ink3: `rgba(${rgb}, ${dark ? 0.56 : 0.62})`,
    hair: `rgba(${rgb}, 0.1)`,
    tint: `rgba(${rgb}, ${dark ? 0.06 : 0.05})`,
    accent: fixContrast(toHex(parseColor(accent)), base, 3),
  };
}

export interface ContrastLine {
  role: RoleKey;
  ratio: number;
  target: number;
  pass: boolean;
}

export function contrastReport(roles: ThemeRoles): ContrastLine[] {
  return (Object.entries(TARGETS) as Array<[RoleKey, number]>).map(([role, target]) => {
    const ratio = contrastRatio(roles[role], roles.field);
    return { role, ratio, target, pass: ratio >= target };
  });
}

export function blockingModes(theme: NuvoTheme): PresetMode[] {
  return (["light", "dark"] as const).filter((mode) => {
    const roles = theme.modes[mode];
    return roles !== undefined && Math.min(contrastRatio(roles.ink, roles.field), contrastRatio(roles.ink, roles.raised)) < BLOCK_BELOW;
  });
}

export function focusRing(roles: ThemeRoles): string {
  return contrastRatio(roles.accent, roles.field) >= 3 ? roles.accent : roles.ink;
}

export function themeTokens(theme: NuvoTheme, mode: PresetMode): Tokens {
  const roles = rolesFor(theme, mode);
  return {
    "n-field": roles.field,
    "n-deep": roles.deep,
    "n-raised": roles.raised,
    "n-ink": roles.ink,
    "n-ink-2": roles.ink2,
    "n-ink-3": roles.ink3,
    "n-hair": roles.hair,
    "n-tint": roles.tint,
    "n-accent": roles.accent,
    "n-ring": focusRing(roles),
  };
}

export function themeFromPreset(preset: Preset, name: string, id: string): NuvoTheme {
  const modes: NuvoTheme["modes"] = {};
  for (const mode of preset.modes) {
    const t = preset.tokens[mode]!;
    const pick = (token: keyof Tokens) => normalizeColour(t[token])!;
    modes[mode] = {
      field: pick("n-field"),
      deep: pick("n-deep"),
      raised: pick("n-raised"),
      ink: pick("n-ink"),
      ink2: pick("n-ink-2"),
      ink3: pick("n-ink-3"),
      hair: pick("n-hair"),
      tint: pick("n-tint"),
      accent: pick("n-accent"),
    };
  }
  return { format: "nuvo-theme", version: 1, id, name, modes, defaultMode: preset.modes[0] };
}
