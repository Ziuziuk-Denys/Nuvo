import { useTheme } from "next-themes";
import { useAppearanceStore, activeTheme } from "@/data/look/appearance/appearanceStore";
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
