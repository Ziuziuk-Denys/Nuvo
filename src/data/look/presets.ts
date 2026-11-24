import recorded from "./presetTokens.json";
import { presetFlatSvg, presetRenderUrl } from "./presetIcons";
import stockDark from "../../../build/icons/themes/nuvo.svg?raw";
import stockLight from "../../../build/icons/themes/nuvo-light.svg?raw";

export type PresetId = "nuvo" | "ink" | "frost" | "moss" | "matcha" | "amber" | "dusk" | "blossom" | "velvet";
export type PresetMode = "light" | "dark";
export type Tokens = Record<string, string>;

export interface Preset {
  id: PresetId;
  modes: PresetMode[];
  tokens: Partial<Record<PresetMode, Tokens>>;
}

export const PRESET_IDS: PresetId[] = ["nuvo", "ink", "frost", "moss", "matcha", "amber", "dusk", "blossom", "velvet"];

const table = recorded as Record<PresetId, { modes: PresetMode[]; tokens: Partial<Record<PresetMode, Tokens>> }>;

export const PRESETS: Preset[] = PRESET_IDS.map((id) => ({ id, modes: table[id].modes, tokens: table[id].tokens }));

export function getPreset(id: string): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}

export function resolvePresetMode(preset: Preset, wanted: PresetMode): PresetMode {
  return preset.modes.includes(wanted) ? wanted : preset.modes[0];
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function presetIconSrc(id: PresetId, mode: PresetMode): string {
  if (id === "nuvo") return svgUrl(mode === "light" ? stockLight : stockDark);
  return presetRenderUrl(id, resolvePresetMode(getPreset(id), mode));
}

export function presetSmallIconSrc(id: PresetId, mode: PresetMode): string {
  if (id === "nuvo") return presetIconSrc(id, mode);
  return svgUrl(presetFlatSvg(id, resolvePresetMode(getPreset(id), mode)));
}
