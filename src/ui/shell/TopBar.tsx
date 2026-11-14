import type { JSX, KeyboardEvent, MouseEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Cover } from "../components/Cover";
import { Lens } from "../components/Lens";
import { useContextMenu } from "../components/Menu";
import { Tooltip } from "../components/Tooltip";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { useTranslation } from "../ports/i18n";
import { importsPercent } from "../ports/imports";
import { useImportSummaries } from "../ports/importsRuntime";
import { livePins, useHomePinsStore, usePlaylistsList, useRailPinsStore, type HomePin } from "../ports/library";
import { useModalStore } from "../ports/navigation";
import { unpinEverywhere } from "../screens/entity/entityActions";
import { PaletteField } from "../screens/palette/Palette";
import { activeNav, isEntityRoute, navigateWithTransition, type NavItem } from "./navigate";
import styles from "./TopBar.module.css";
import { WindowButtons } from "./WindowButtons";

interface Section {
  id: NavItem;
  icon: IconName;
  label: string;
  href: string;
}

const MAX_PINS = 6;

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function TopBar(): JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const openSettings = useModalStore((state) => state.openSettings);
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const barPins = useRailPinsStore((state) => state.pins);
  const homePins = useHomePinsStore((state) => state.pins);
  const playlists = usePlaylistsList();
  const pinMenu = useContextMenu();
  // a failed fetch lists no playlists, so only a clean one may hide pins of deleted playlists
  const settled = playlists.isFetched && !playlists.error && !playlists.isLoading;
  const pins = [...barPins, ...homePins.filter((pin) => !barPins.some((own) => own.kind === pin.kind && own.id === pin.id))].slice(0, MAX_PINS);
  const shown = livePins(pins, settled ? playlists.data.playlists.map((playlist) => playlist.id) : null);
  const importing = importsPercent(useImportSummaries());
  const importingText = importing === null ? "" : t("ui.library.importing", { percent: importing });
  const entity = isEntityRoute(pathname);
  const active = activeNav(pathname);

  const sections: Section[] = [
    { id: "home", icon: "home", label: t("ui.nav.home"), href: "/" },
    { id: "library", icon: "library", label: t("ui.nav.library"), href: "/library" },
    { id: "stats", icon: "stats", label: t("ui.nav.stats"), href: "/stats" },
    { id: "recognize", icon: "recognize", label: t("ui.nav.recognize"), href: "/recognize" },
  ];

  const go = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    // a pointer click must not leave the focus fill behind; Enter from the keyboard keeps focus
    if (event.detail > 0) event.currentTarget.blur();
    navigateWithTransition(navigate, href);
  };

  const goBack = () => {
    if (window.history.length > 1) void navigate(-1);
    else void navigate("/library");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("a")];
    const at = controls.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: controls.length - 1 };
    if (at < 0 || !(event.key in moves)) return;
    event.preventDefault();
    controls[(moves[event.key] + controls.length) % controls.length].focus();
  };

  return (
    <header className={styles.bar} data-window-drag>
      <div className={styles.start}>
        <a href="#/" className={styles.mark} aria-label="Nuvo" data-no-window-drag onClick={(event) => go(event, "/")}>
          <Icon name="nuvo-mark" size={24} />
        </a>
        <nav aria-label={t("ui.nav.label")} className={`${styles.group} ${styles.tray}`} data-no-window-drag onKeyDown={onKeyDown}>
          {sections.map((section) => (
            <Tooltip key={section.id} text={section.id === "library" && importingText ? `${section.label} · ${importingText}` : section.label}>
              <a
                href={`#${section.href}`}
                data-nav={section.id}
                aria-label={section.label}
                aria-current={section.id === active ? "page" : undefined}
                className={styles.item}
                onClick={(event) => go(event, section.href)}
              >
                {section.id === active ? <Lens group="top-nav" value={section.id} radius={18} /> : null}
                <Icon name={section.icon} size={24} />
                {section.id === "library" && importing !== null ? (
                  <span
                    className={styles.progress}
                    role="progressbar"
                    aria-label={importingText}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={importing}
                  >
                    <span style={{ transform: `scaleX(${importing / 100})` }} />
                  </span>
                ) : null}
              </a>
            </Tooltip>
          ))}
        </nav>
        {shown.length > 0 ? (
          <nav aria-label={t("ui.nav.pinned")} className={`${styles.group} ${styles.tray} ${styles.pins}`} data-no-window-drag onKeyDown={onKeyDown}>
            {shown.map((pin: HomePin) => (
              <Tooltip key={`${pin.kind}:${pin.id}`} text={pin.title}>
                <a
                  href={`#${pin.href}`}
                  data-pin={pin.kind}
                  aria-label={pin.title}
                  className={styles.item}
                  onClick={(event) => go(event, pin.href)}
                  onContextMenu={(event) => pinMenu.open(event, [{ label: t("ui.library.unpin"), onSelect: () => unpinEverywhere(pin.kind, pin.id) }])}
                >
                  {pin.imageUrl ? (
                    <Cover src={pin.imageUrl} size={26} radius={6} shape={pin.kind === "artist" ? "circle" : "square"} />
                  ) : (
                    <Icon name={pin.kind === "artist" ? "artist" : pin.kind === "album" ? "album" : "playlist"} size={20} />
                  )}
                </a>
              </Tooltip>
            ))}
          </nav>
        ) : null}
        {pinMenu.element}
        {entity ? (
          <button type="button" className={styles.back} onClick={goBack} data-no-window-drag>
            <Icon name="back" size={16} />
            <span>{t("ui.nav.back")}</span>
          </button>
        ) : null}
      </div>
      <div className={styles.middle}>
        <PaletteField />
      </div>
      <div className={styles.end}>
        <div className={`${styles.group} ${styles.tray}`}>
          <Tooltip text={t("ui.nav.settings")}>
            <button
              type="button"
              aria-label={t("ui.nav.settings")}
              aria-pressed={settingsOpen}
              className={styles.item}
              data-nuvo-guard="grid"
              data-no-window-drag
              onClick={openSettings}
            >
              <Icon name="settings" size={24} />
            </button>
          </Tooltip>
          <span className={styles.rule} aria-hidden="true" />
          <WindowButtons />
        </div>
      </div>
    </header>
  );
}
