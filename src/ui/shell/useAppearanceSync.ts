import { useEffect } from "react";
import { useToastStore } from "../feedback/toastStore";
import { applyFontSettings, DEFAULT_FONTS, dropUserFonts, loadUserFont, removeCustomCss, useAppearanceStore, watchCustomCss } from "../ports/appearance";
import { useTranslation } from "../ports/i18n";

// Delay before telling main the start went fine; safe mode counts crashed starts
export const READY_DELAY_MS = 2000;

export function useAppearanceSync(): void {
  const { t } = useTranslation();
  const fonts = useAppearanceStore((s) => s.saved.fonts);
  const fontFiles = useAppearanceStore((s) => s.saved.fontFiles);
  const customCss = useAppearanceStore((s) => s.saved.customCss);
  const safe = useAppearanceStore((s) => s.safe);
  const loaded = useAppearanceStore((s) => s.loaded);

  useEffect(() => {
    const reload = () => void useAppearanceStore.getState().load();
    reload();
    window.addEventListener("library:changed", reload);
    return () => window.removeEventListener("library:changed", reload);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.nuvoShell?.appearanceApplying();
    const timer = setTimeout(() => window.nuvoShell?.appearanceReady(), READY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded]);

  useEffect(() => {
    const root = document.documentElement;
    const chosen = safe ? DEFAULT_FONTS : fonts;
    applyFontSettings(root, chosen, new Set());
    const files = fontFiles.filter((file) => [chosen.ui, chosen.lyrics].some((c) => c.kind === "file" && c.id === file.id));
    dropUserFonts(new Set(files.map((file) => file.id)));
    if (files.length === 0) return;
    let cancelled = false;
    void Promise.all(files.map(async (file) => ((await loadUserFont(file)) ? file.id : null))).then((ids) => {
      if (!cancelled) applyFontSettings(root, chosen, new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [fonts, fontFiles, safe]);

  // Custom CSS goes through customCss.ts only: it sanitizes, installs in its layer and guards
  useEffect(() => {
    if (safe || !customCss.enabled) {
      removeCustomCss(document);
      return;
    }
    return watchCustomCss(document, window, customCss.text, (reason) => {
      void useAppearanceStore.getState().save({ customCss: { ...customCss, enabled: false } });
      useToastStore.getState().show({ message: t(reason === "sanitizer" ? "appearance.css.refused" : "appearance.css.guard_off"), variant: "error" });
    });
  }, [customCss, safe, t]);
}
