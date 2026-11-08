import type { CSSProperties, JSX } from "react";
import { CUSTOM_PREFIX, useAppearanceStore } from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";

/** Inline styles from constants: custom CSS is off in safe mode, and the banner must not depend on any sheet it could reach. Colours are the built-in preset's tokens, which safe mode always uses. */
const BANNER: CSSProperties = {
  position: "fixed",
  insetInline: 0,
  top: 60,
  margin: "0 auto",
  width: "fit-content",
  maxWidth: "calc(100vw - 32px)",
  zIndex: 2147483000,
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "8px 8px 8px 16px",
  borderRadius: 14,
  background: "var(--n-raised)",
  boxShadow: "var(--n-sheet-shadow)",
  color: "var(--n-ink)",
  font: "400 13px/18px var(--n-font)",
};

const BUTTON: CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: 0,
  borderRadius: 9,
  background: "color-mix(in srgb, var(--n-ink) 8%, transparent)",
  color: "var(--n-ink)",
  font: "500 13px/18px var(--n-font)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const PRIMARY: CSSProperties = { ...BUTTON, background: "var(--n-ink)", color: "var(--n-field)" };

/** Shown while safe mode keeps a saved custom look switched off (customization 6.1). Mounted once, next to Settings. */
export function SafeModeBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const safe = useAppearanceStore((s) => s.safe);
  const saved = useAppearanceStore((s) => s.saved);
  // Settings says the same in its reset row; a floating banner there would cover its header
  const settingsOpen = useModalStore((s) => s.settingsOpen);
  const custom =
    saved.active.presetId.startsWith(CUSTOM_PREFIX) || saved.customCss.enabled || saved.fonts.ui.kind !== "default" || saved.fonts.lyrics.kind !== "default";
  if (!safe || !custom || settingsOpen) return null;
  return (
    <div role="status" style={BANNER} data-nuvo-guard="flex">
      <span>{t("appearance.safe.banner")}</span>
      <button type="button" style={PRIMARY} onClick={() => void useAppearanceStore.getState().setSafe(false)}>
        {t("appearance.safe.turn_on")}
      </button>
      <button type="button" style={BUTTON} onClick={() => useModalStore.getState().openSettingsSection("customization")}>
        {t("appearance.safe.edit")}
      </button>
    </div>
  );
}
