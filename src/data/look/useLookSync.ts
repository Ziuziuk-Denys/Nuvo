import { useEffect } from "react";
import { useTheme } from "next-themes";
import { usePlayerStore } from "@/engine/compat";
import { coverAccent } from "@/data/covers/accent";
import { readCoverPixels } from "@/data/covers/colors";
import { activeTheme, useAppearanceStore } from "@/data/look/appearance/appearanceStore";
import { fixContrast, themeTokens } from "@/data/look/appearance/deriveTheme";
import { applyPresetTokens, applyTokens } from "./apply";
import { getPreset, resolvePresetMode, type PresetMode } from "./presets";
import { useLookStore } from "./lookStore";

export function useLookSync(): void {
  const { resolvedTheme, setTheme } = useTheme();
  const presetId = useLookStore((s) => s.preset);
  const coverGlow = useLookStore((s) => s.coverGlow);
  const accentFromCover = useLookStore((s) => s.accentFromCover);
  const coverUrl = usePlayerStore((s) => s.currentTrack?.coverUrl ?? "");
  const custom = useAppearanceStore(activeTheme);
  const mode: PresetMode = resolvedTheme === "light" ? "light" : "dark";

  useEffect(() => {
    document.documentElement.dataset.coverGlow = coverGlow ? "on" : "off";
  }, [coverGlow]);

  useEffect(() => {
    const { themeBeforePreset, setThemeBeforePreset } = useLookStore.getState();
    if (custom || themeBeforePreset === null) return;
    setTheme(themeBeforePreset);
    setThemeBeforePreset(null);
  }, [setTheme, custom]);

  useEffect(() => {
    const root = document.documentElement;
    let cancelled = false;
    const preset = getPreset(presetId);
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
  }, [presetId, mode, custom, accentFromCover, coverUrl]);
}
