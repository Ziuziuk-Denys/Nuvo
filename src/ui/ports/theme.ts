import { useTheme } from "next-themes";
import { useAppearanceStore, activeTheme } from "@/data/look/appearance/appearanceStore";
import { themeTokens } from "@/data/look/appearance/deriveTheme";
import { applyPresetTokens, applyTokens } from "@/data/look/apply";
import { useLookStore } from "@/data/look/lookStore";
import { getPreset, resolvePresetMode, type PresetId, type PresetMode } from "@/data/look/presets";

export type { PresetId, PresetMode };
export { PRESETS, getPreset, presetIconSvg } from "@/data/look/presets";
export { revealThemeChange } from "@/data/look/reveal";
export { useLookSync } from "@/data/look/useLookSync";
export { useAppIconSync } from "@/data/look/appIcon";

export type ThemeMode = "light" | "dark" | "system";

// The one hook a port holds: screens may not import next-themes
export function useLook(): { preset: PresetId; mode: PresetMode } {
  const preset = useLookStore((s) => s.preset);
  const custom = useAppearanceStore(activeTheme);
  const { resolvedTheme } = useTheme();
  const requested = resolvedTheme === "light" ? "light" : "dark";
  // a custom theme has both modes and the default preset's light rules
  return custom ? { preset: "nuvo", mode: requested } : { preset, mode: resolvePresetMode(getPreset(preset), requested) };
}

export function useThemeMode(): ThemeMode {
  const { theme } = useTheme();
  return theme === "light" || theme === "dark" ? theme : "system";
}

export function useSetThemeMode(): (mode: ThemeMode) => void {
  const { setTheme } = useTheme();
  const setThemeBeforePreset = useLookStore((s) => s.setThemeBeforePreset);
  return (mode) => {
    setThemeBeforePreset(null);
    setTheme(mode);
  };
}

// A window that crashes on its first render never ran useLookSync, so the crash screen paints the saved look itself
export function applySavedLook(): void {
  const root = document.documentElement;
  if (root.dataset.look) return;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {
    saved = null;
  }
  const light = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
  const wanted: PresetMode = saved === "light" || saved === "dark" ? saved : light ? "light" : "dark";
  const custom = activeTheme(useAppearanceStore.getState());
  const preset = getPreset(useLookStore.getState().preset);
  const mode = custom ? wanted : resolvePresetMode(preset, wanted);
  if (custom) applyTokens(root, `custom:${custom.id}`, themeTokens(custom, mode));
  else applyPresetTokens(root, preset, mode);
  root.dataset.theme = mode;
}
