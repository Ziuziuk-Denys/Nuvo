import type { PresetMode } from "./presets";

export type RenderedPresetId = "ink" | "frost" | "moss" | "matcha" | "amber" | "dusk" | "blossom" | "velvet";

const RENDERS = import.meta.glob<string>("./presetIcons/*.webp", { query: "?url", import: "default", eager: true });

const MARK =
  "M32 62 A30 30 0 0 1 62 32 L87.92 32 A14 14 0 0 1 100.04 39 L130.14 91.14 A16 16 0 0 0 160 83.14 L160 50 A18 18 0 0 1 178 32 L194 32 A30 30 0 0 1 224 62 L224 194 A30 30 0 0 1 194 224 L168.08 224 A14 14 0 0 1 155.96 217 L125.86 164.86 A16 16 0 0 0 96 172.86 L96 206 A18 18 0 0 1 78 224 L62 224 A30 30 0 0 1 32 194 Z";

type Flat = [tileTop: string, tileBottom: string, mark: string];

const FLAT: Record<RenderedPresetId, Record<PresetMode, Flat>> = {
  ink: { dark: ["#343437", "#161618", "#ffffff"], light: ["#fbfaf7", "#e9e8e3", "#161618"] },
  frost: { dark: ["#0c3242", "#041b22", "#c9eef7"], light: ["#e9f5fa", "#cfe9f2", "#2f86a2"] },
  moss: { dark: ["#17402b", "#0a2618", "#63c184"], light: ["#ecf6ef", "#d6eddf", "#1f693a"] },
  matcha: { dark: ["#333c12", "#181e04", "#c4d66a"], light: ["#f5f8e6", "#e6edc9", "#7d9424"] },
  amber: { dark: ["#34200a", "#1b0d00", "#f3a52a"], light: ["#fbeccd", "#f0dab5", "#9a5212"] },
  dusk: { dark: ["#5a3018", "#33190a", "#f0a27c"], light: ["#fde0cd", "#f8ceb5", "#b4532a"] },
  blossom: { dark: ["#471a33", "#27071d", "#f3d5e6"], light: ["#fdeff6", "#f6dcea", "#d9628f"] },
  velvet: { dark: ["#2a1166", "#14043c", "#b59cff"], light: ["#e4dbfb", "#c9bbef", "#3f1a9c"] },
};

export function presetRenderUrl(id: RenderedPresetId, mode: PresetMode): string {
  return RENDERS[`./presetIcons/${id}-${mode}.webp`];
}

// 24 px and below: a render turns to mush there, so the same colours are drawn flat and larger
export function presetFlatSvg(id: RenderedPresetId, mode: PresetMode): string {
  const [top, bottom, mark] = FLAT[id][mode];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>` +
    `<linearGradient id="bg" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
    `<rect width="256" height="256" rx="56" fill="url(#bg)"/>` +
    `<path d="${MARK}" fill="${mark}" transform="translate(128 128) scale(0.86) translate(-128 -128)"/></svg>`
  );
}
