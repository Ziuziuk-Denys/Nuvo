import { useEffect } from "react";
import { useTheme } from "next-themes";
import { usePlayerStore } from "@/engine/compat";
import { coverAccent } from "@/data/covers/accent";
import { readCoverPixels } from "@/data/covers/colors";
import { activeTheme, useAppearanceStore } from "@/data/look/appearance/appearanceStore";
import { fixContrast, themeTokens } from "@/data/look/appearance/deriveTheme";
import { applyPresetTokens, applyTokens } from "./apply";
import { getPreset, resolvePresetMode, type Preset, type PresetId, type PresetMode } from "./presets";
import { selectIsGlassThemeActive, useLookStore, type ThemeChoice } from "./lookStore";

/** Under a wallpaper a light-only preset gives way to the default look (the settings screen says so). */
export function effectivePreset(id: PresetId, glass: boolean): Preset {
  const chosen = getPreset(id);
  return glass && !chosen.modes.includes("dark") ? getPreset("nuvo") : chosen;
}

/** A one-mode preset forces its mode and remembers the old choice; a two-mode preset restores it. */
export function modeStep(preset: Preset, theme: ThemeChoice, before: ThemeChoice | null): { setTheme?: ThemeChoice; before: ThemeChoice | null } {
  if (preset.modes.length === 1) {
    const forced = preset.modes[0];
    if (theme === forced) return { before };
    return { setTheme: forced, before: before ?? theme };
  }
  if (before !== null) return { setTheme: before, before: null };
  return { before: null };
}

/** Applies the look settings to the window. Mounted once in the shell. */
export function useLookSync(): void {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const presetId = useLookStore((s) => s.preset);
  const glass = useLookStore(selectIsGlassThemeActive);
  const coverGlow = useLookStore((s) => s.coverGlow);
  const accentFromCover = useLookStore((s) => s.accentFromCover);
  const coverUrl = usePlayerStore((s) => s.currentTrack?.coverUrl ?? "");
  const custom = useAppearanceStore(activeTheme);
  const mode: PresetMode = resolvedTheme === "light" ? "light" : "dark";

  useEffect(() => {
    document.documentElement.dataset.coverGlow = coverGlow ? "on" : "off";
  }, [coverGlow]);

  // a custom theme has both modes and never forces one
  useEffect(() => {
    if (custom) return;
    const choice: ThemeChoice = theme === "light" || theme === "dark" ? theme : "system";
    const { themeBeforePreset, setThemeBeforePreset } = useLookStore.getState();
    const step = modeStep(effectivePreset(presetId, glass), choice, themeBeforePreset);
    if (step.before !== themeBeforePreset) setThemeBeforePreset(step.before);
    if (step.setTheme) setTheme(step.setTheme);
  }, [presetId, glass, theme, setTheme, custom]);

  useEffect(() => {
    const root = document.documentElement;
    let cancelled = false;
    const preset = effectivePreset(presetId, glass);
    // data-preset names the look in force: the preset, or `custom:<id>` for a saved theme
    root.dataset.preset = custom ? `custom:${custom.id}` : preset.id;
    if (custom) applyTokens(root, `custom:${custom.id}`, themeTokens(custom, mode));
    else applyPresetTokens(root, preset, resolvePresetMode(preset, mode));
    if (accentFromCover && coverUrl) {
      readCoverPixels(coverUrl)
        .then((pixels) => {
          if (cancelled) return;
          const field = root.style.getPropertyValue("--n-field").trim() || (mode === "light" ? "#ffffff" : "#000000");
          root.style.setProperty("--n-accent", fixContrast(coverAccent(pixels, mode === "light"), field, 3));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [presetId, glass, mode, custom, accentFromCover, coverUrl]);
}
