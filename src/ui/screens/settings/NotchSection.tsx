import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { getNotchSession, useNotchSettingsStore, type NotchSession } from "../../ports/notch";
import { Segmented, SettingGroup, SettingRow, Switch } from "./controls";
import { PanelWidgetRow } from "./PanelWidgetRow";
import styles from "./sections.module.css";

const DESKTOP_NAMES: Record<string, string> = {
  "gnome-wayland": "settings.notch.desktop_gnome",
  "kde-wayland": "settings.notch.desktop_kde",
  hyprland: "settings.notch.desktop_hyprland",
  sway: "settings.notch.desktop_sway",
  x11: "settings.notch.desktop_x11",
  windows: "settings.notch.desktop_windows",
  macos: "settings.notch.desktop_macos",
  "other-wayland": "settings.notch.desktop_wayland",
};

export function NotchSection(): JSX.Element {
  const { t } = useTranslation();
  const notch = useNotchSettingsStore();
  const [session, setSession] = useState<NotchSession | null>(null);

  useEffect(() => {
    let live = true;
    void getNotchSession().then((info) => {
      if (live) setSession(info);
    });
    return () => {
      live = false;
    };
  }, []);

  const unsupported = session !== null && !session.supported;
  const desktopName = session ? t(DESKTOP_NAMES[session.session] ?? "settings.notch.desktop_wayland") : "";

  return (
    <>
      <SettingGroup label={t("settings.page.notch_when")}>
        <SettingRow
          title={t("settings.notch.mode")}
          description={t("settings.notch.description")}
          titleKey="settings.notch.mode"
          descKey="settings.notch.description"
          control={
            <Segmented
              label={t("settings.notch.mode")}
              value={notch.mode}
              onChange={(mode) => notch.setSettings({ mode })}
              options={[
                { value: "auto", label: t("settings.notch.mode_auto") },
                { value: "on", label: t("settings.notch.mode_on"), disabled: unsupported, reason: t("settings.notch.unsupported") },
                { value: "off", label: t("settings.notch.mode_off") },
              ]}
            />
          }
        />
        {session ? (
          <p className={styles.status} data-testid="notch-session" data-warn={unsupported ? "" : undefined} role={unsupported ? "status" : undefined}>
            {unsupported ? t("settings.notch.unsupported_here", { desktop: desktopName }) : t("settings.notch.session", { session: desktopName })}
            {unsupported && notch.mode === "on" ? ` ${t("settings.notch.unsupported_on")}` : ""}
          </p>
        ) : null}
        {session?.placementError ? (
          <p className={styles.status} data-warn="">
            {t("settings.notch.placement_error")}
          </p>
        ) : null}
      </SettingGroup>
      <SettingGroup label={t("settings.page.notch_behaviour")}>
        <SettingRow
          title={t("settings.notch.expand_on")}
          titleKey="settings.notch.expand_on"
          control={
            <Segmented
              label={t("settings.notch.expand_on")}
              value={notch.expandOn}
              onChange={(expandOn) => notch.setSettings({ expandOn })}
              options={[
                { value: "hover", label: t("settings.notch.expand_hover") },
                { value: "click", label: t("settings.notch.expand_click") },
              ]}
            />
          }
        />
        <SettingRow
          title={t("settings.notch.show_lyrics")}
          titleKey="settings.notch.show_lyrics"
          control={<Switch label={t("settings.notch.show_lyrics")} checked={notch.showLyrics} onChange={(showLyrics) => notch.setSettings({ showLyrics })} />}
        />
        <SettingRow
          title={t("settings.notch.pulse")}
          titleKey="settings.notch.pulse"
          control={
            <Switch
              label={t("settings.notch.pulse")}
              checked={notch.pulseOnTrackChange}
              onChange={(pulseOnTrackChange) => notch.setSettings({ pulseOnTrackChange })}
            />
          }
        />
      </SettingGroup>
      <SettingGroup label={t("settings.page.notch_screen")}>
        <SettingRow
          title={t("settings.notch.display")}
          titleKey="settings.notch.display"
          control={
            <Segmented
              label={t("settings.notch.display")}
              value={notch.display}
              onChange={(display) => notch.setSettings({ display })}
              options={[
                { value: "follow", label: t("settings.notch.display_follow") },
                { value: "primary", label: t("settings.notch.display_primary") },
              ]}
            />
          }
        />
      </SettingGroup>
      {session?.panel ? (
        <SettingGroup label={t("settings.page.notch_panel")}>
          <PanelWidgetRow panel={session.panel} instead={unsupported} />
        </SettingGroup>
      ) : null}
    </>
  );
}
