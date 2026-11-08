import recorded from "./presetTokens.json";

/** The built-in looks: colours recorded from the running app, icons from the brand set. */
export type PresetId = "nuvo" | "editor" | "orbit" | "vinyl" | "cosmos" | "sunset" | "amethyst" | "y2k" | "cassette";
export type PresetMode = "light" | "dark";
export type Tokens = Record<string, string>;

export interface Preset {
  id: PresetId;
  modes: PresetMode[];
  tokens: Partial<Record<PresetMode, Tokens>>;
}

export const PRESET_IDS: PresetId[] = ["nuvo", "editor", "orbit", "vinyl", "cosmos", "sunset", "amethyst", "y2k", "cassette"];

const table = recorded as Record<PresetId, { modes: PresetMode[]; tokens: Partial<Record<PresetMode, Tokens>> }>;

export const PRESETS: Preset[] = PRESET_IDS.map((id) => ({ id, modes: table[id].modes, tokens: table[id].tokens }));

export function getPreset(id: string): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}

export function resolvePresetMode(preset: Preset, wanted: PresetMode): PresetMode {
  return preset.modes.includes(wanted) ? wanted : preset.modes[0];
}

const ICON_DIR = "../../../build/icons/themes/";
const icons = import.meta.glob("../../../build/icons/themes/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function presetIconSvg(id: PresetId, mode: PresetMode): string {
  const name = id === "nuvo" && mode === "light" ? "nuvo-light" : id;
  return icons[`${ICON_DIR}${name}.svg`] ?? icons[`${ICON_DIR}nuvo.svg`] ?? "";
}
