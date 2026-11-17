import { useEffect, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Menu, type MenuItem } from "../../components/Menu";
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

const OFFSETS = ["0", "4", "8", "16", "32"] as const;
// Hyprland and Sway draw layer-shell bars over every window, so a window cannot choose its stacking there
const FIXED_STACKING = new Set(["hyprland", "sway"]);

export function NotchSection(): JSX.Element {
  const { t } = useTranslation();
  const notch = useNotchSettingsStore();
  const [session, setSession] = useState<NotchSession | null>(null);
  const [displayMenu, setDisplayMenu] = useState<HTMLElement | null>(null);

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
  const displays = session?.displays ?? [];
  const chosenDisplay = displays.find((display) => display.id === notch.display);
  const displayLabel = chosenDisplay?.label ?? t(notch.display === "follow" ? "settings.notch.display_follow" : "settings.notch.display_primary");
  const displayChoice = (display: typeof notch.display, label: string): MenuItem => ({
    label,
    icon: notch.display === display ? "check" : undefined,
    onSelect: () => notch.setSettings({ display }),
  });
  const displayItems: MenuItem[] = [
    displayChoice("follow", t("settings.notch.display_follow")),
    displayChoice("primary", t("settings.notch.display_primary")),
    ...(displays.length > 0 ? ["separator" as const] : []),
    ...displays.map((display) => displayChoice(display.id, display.label)),
  ];

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
            <Button size="s" aria-haspopup="menu" aria-expanded={displayMenu !== null} onClick={(event) => setDisplayMenu(event.currentTarget)}>
              {displayLabel}
            </Button>
          }
        />
        <SettingRow
          title={t("settings.notch.position")}
          titleKey="settings.notch.position"
          control={
            <Segmented
              label={t("settings.notch.position")}
              value={notch.position}
              onChange={(position) => notch.setSettings({ position })}
              options={[
                { value: "left", label: t("settings.notch.position_left") },
                { value: "center", label: t("settings.notch.position_center") },
                { value: "right", label: t("settings.notch.position_right") },
              ]}
            />
          }
        />
        <SettingRow
          title={t("settings.notch.edge")}
          description={t("settings.notch.edge_desc")}
          titleKey="settings.notch.edge"
          descKey="settings.notch.edge_desc"
          control={
            <Segmented
              label={t("settings.notch.edge")}
              value={notch.edge}
              onChange={(edge) => notch.setSettings({ edge })}
              options={[
                { value: "auto", label: t("settings.notch.edge_auto") },
                { value: "screen", label: t("settings.notch.edge_screen") },
                { value: "bar", label: t("settings.notch.edge_bar") },
              ]}
            />
          }
        />
        <SettingRow
          title={t("settings.notch.offset")}
          description={t("settings.notch.offset_desc")}
          titleKey="settings.notch.offset"
          descKey="settings.notch.offset_desc"
          control={
            <Segmented
              label={t("settings.notch.offset")}
              value={String(notch.offset)}
              onChange={(offset) => notch.setSettings({ offset: Number(offset) })}
              options={OFFSETS.map((px) => ({ value: px, label: t("settings.notch.offset_px", { px }) }))}
            />
          }
        />
        {session && !FIXED_STACKING.has(session.session) ? (
          <SettingRow
            title={t("settings.notch.stacking")}
            description={t("settings.notch.stacking_desc")}
            titleKey="settings.notch.stacking"
            descKey="settings.notch.stacking_desc"
            control={
              <Segmented
                label={t("settings.notch.stacking")}
                value={notch.stacking}
                onChange={(stacking) => notch.setSettings({ stacking })}
                options={[
                  { value: "above", label: t("settings.notch.stacking_above") },
                  { value: "normal", label: t("settings.notch.stacking_normal") },
                ]}
              />
            }
          />
        ) : null}
      </SettingGroup>
      <Menu open={displayMenu !== null} anchor={displayMenu} onClose={() => setDisplayMenu(null)} items={displayItems} />
      {session?.panel ? (
        <SettingGroup label={t("settings.page.notch_panel")}>
          <PanelWidgetRow panel={session.panel} instead={unsupported} />
        </SettingGroup>
      ) : null}
    </>
  );
}
