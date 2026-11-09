import type { JSX, KeyboardEvent, MouseEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Cover } from "../components/Cover";
import { useContextMenu } from "../components/Menu";
import { Tooltip } from "../components/Tooltip";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { useTranslation } from "../ports/i18n";
import { importsPercent } from "../ports/imports";
import { useImportSummaries } from "../ports/importsRuntime";
import { useModalStore } from "../ports/navigation";
import { livePins, usePlaylistsList, useRailPinsStore, type HomePin } from "../ports/library";
import { activeNav, navigateWithTransition, type NavItem } from "./navigate";
import styles from "./Rail.module.css";

interface RailItem {
  id: NavItem;
  icon: IconName;
  label: string;
  href: string;
}

export function Rail(): JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const searchOpen = useModalStore((state) => state.searchOpen);
  const openSettings = useModalStore((state) => state.openSettings);
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const pins = useRailPinsStore((state) => state.pins);
  const playlists = usePlaylistsList();
  const pinMenu = useContextMenu();
  // a failed fetch lists no playlists, so only a clean one may hide pins of deleted playlists
  const settled = playlists.isFetched && !playlists.error && !playlists.isLoading;
  const shown = livePins(pins, settled ? playlists.data.playlists.map((playlist) => playlist.id) : null);
  const importing = importsPercent(useImportSummaries());
  const importingText = importing === null ? "" : t("ui.library.importing", { percent: importing });

  const items: RailItem[] = [
    { id: "home", icon: "home", label: t("ui.nav.home"), href: "#/" },
    { id: "search", icon: "search", label: t("ui.nav.search"), href: "#/search" },
    { id: "recognize", icon: "recognize", label: t("ui.nav.recognize"), href: "#/recognize" },
    { id: "library", icon: "library", label: t("ui.nav.library"), href: "#/library" },
    { id: "stats", icon: "stats", label: t("ui.nav.stats"), href: "#/stats" },
  ];

  const active = searchOpen ? "search" : activeNav(pathname);

  const openPin = (event: MouseEvent<HTMLAnchorElement>, pin: HomePin) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateWithTransition(navigate, pin.href);
  };

  const go = (event: MouseEvent<HTMLAnchorElement>, { href }: RailItem) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateWithTransition(navigate, href.slice(1));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("a, button")];
    const at = controls.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: controls.length - 1,
    };
    if (at < 0 || !(event.key in moves)) return;
    event.preventDefault();
    controls[(moves[event.key] + controls.length) % controls.length].focus();
  };

  return (
    <aside className={styles.rail} onKeyDown={onKeyDown}>
      <nav aria-label={t("ui.nav.label")} className={styles.list}>
        {items.map((item) => (
          <Tooltip key={item.id} text={item.id === "library" && importingText ? `${item.label} · ${importingText}` : item.label}>
            <a
              href={item.href}
              data-nav={item.id}
              aria-label={item.label}
              aria-current={item.id === active ? "page" : undefined}
              className={styles.item}
              onClick={(event) => go(event, item)}
            >
              <Icon name={item.icon} size={26} />
              {item.id === "library" && importing !== null ? (
                <span className={styles.progress} role="progressbar" aria-label={importingText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={importing}>
                  <span style={{ transform: `scaleX(${importing / 100})` }} />
                </span>
              ) : null}
            </a>
          </Tooltip>
        ))}
      </nav>
      {shown.length > 0 ? (
        <nav aria-label={t("ui.nav.pinned")} className={styles.pins}>
          {shown.map((pin) => (
            <Tooltip key={`${pin.kind}:${pin.id}`} text={pin.title}>
              <a
                href={`#${pin.href}`}
                data-pin={pin.kind}
                aria-label={pin.title}
                className={styles.item}
                onClick={(event) => openPin(event, pin)}
                onContextMenu={(event) =>
                  pinMenu.open(event, [{ label: t("ui.library.unpin_rail"), onSelect: () => useRailPinsStore.getState().unpin(pin.kind, pin.id) }])
                }
              >
                {pin.imageUrl ? (
                  <Cover src={pin.imageUrl} size={30} shape={pin.kind === "artist" ? "circle" : "square"} />
                ) : (
                  <Icon name={pin.kind === "artist" ? "artist" : pin.kind === "album" ? "album" : "playlist"} size={20} />
                )}
              </a>
            </Tooltip>
          ))}
        </nav>
      ) : null}
      {pinMenu.element}
      <button type="button" aria-label={t("ui.nav.settings")} aria-pressed={settingsOpen} className={styles.item} data-nuvo-guard="grid" onClick={openSettings}>
        <Icon name="settings" size={26} />
      </button>
    </aside>
  );
}
