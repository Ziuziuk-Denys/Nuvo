import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { useTranslation } from "../../ports/i18n";
import { enablePanelWidget, installPanelWidget, openExtensionsApp, type NotchSession, type PanelInstallResult } from "../../ports/notch";
import { SettingRow } from "./controls";
import styles from "./sections.module.css";

type Panel = NonNullable<NotchSession["panel"]>;

/**
 * Offers the desktop's own panel widget; nothing is installed until the button is pressed. A profile whose
 * folders are moved away from HOME gets the manual steps instead, and GNOME's Turn on waits for the next login.
 */
export function PanelWidgetRow({ panel, instead }: { panel: Panel; instead: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(() => {
    if (!panel.available) return t("settings.notch.panel_missing_files");
    if (panel.manual) return t(`settings.notch.panel_manual_${panel.target}`, { path: panel.source ?? "" });
    return panel.pendingEnable ? t("settings.notch.panel_relogin") : null;
  });
  const [turnOn, setTurnOn] = useState(Boolean(panel.pendingEnable) && !panel.manual);
  const [snippet, setSnippet] = useState<string | null>(null);

  const describe = (result: PanelInstallResult, again: boolean): string => {
    if (!result.ok) {
      if (result.error === "missing-files") return t("settings.notch.panel_missing_files");
      if (result.error === "missing-tool") return t("settings.notch.panel_missing_tool");
      return t("settings.notch.panel_failed", { error: result.error });
    }
    if (result.next === "add-module") return t("settings.notch.panel_add_module", { path: "~/.config/waybar/nuvo" });
    if (result.next === "relogin" && again) return t("settings.notch.panel_not_loaded");
    return t(`settings.notch.panel_${result.next === "add-widget" ? "add_widget" : result.next}`);
  };

  const run = async (action: () => Promise<PanelInstallResult>, again: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const result = await action();
      setNote(describe(result, again));
      setTurnOn(result.ok && result.next === "relogin");
      setSnippet(result.ok && result.next === "add-module" ? (result.snippet ?? "") : null);
    } finally {
      setBusy(false);
    }
  };

  const title = t(instead ? "settings.notch.panel_instead" : "settings.notch.panel");
  return (
    <>
      <SettingRow
        title={title}
        description={t(`settings.notch.panel_${panel.target}`)}
        explained
        titleKey={instead ? "settings.notch.panel_instead" : "settings.notch.panel"}
        descKey={`settings.notch.panel_${panel.target}`}
        control={
          panel.manual ? undefined : (
            <Button
              size="s"
              variant={instead && !turnOn ? "primary" : undefined}
              disabled={busy || !panel.available}
              onClick={() => void run(installPanelWidget, false)}
              data-testid="panel-install"
            >
              {busy ? t("settings.notch.panel_installing") : t(panel.target === "waybar" ? "settings.notch.panel_set_up" : "settings.notch.panel_install")}
            </Button>
          )
        }
      />
      {note ? (
        <p className={styles.note} role="status" data-testid="panel-note">
          {note}
        </p>
      ) : null}
      {turnOn ? (
        <div className={styles.note}>
          <Button size="s" variant="primary" disabled={busy} onClick={() => void run(enablePanelWidget, true)} data-testid="panel-turn-on">
            {t("settings.notch.panel_turn_on")}
          </Button>{" "}
          <Button size="s" disabled={busy} onClick={() => void openExtensionsApp()} data-testid="panel-open-extensions">
            {t("settings.notch.panel_open_extensions")}
          </Button>
        </div>
      ) : null}
      {snippet !== null ? (
        <div className={styles.note}>
          <Button size="s" onClick={() => void navigator.clipboard.writeText(snippet).catch(() => undefined)} data-testid="panel-copy-module">
            {t("settings.notch.panel_copy_module")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
