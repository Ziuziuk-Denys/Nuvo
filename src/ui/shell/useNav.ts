import type { MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { IconName } from "../icons";
import { useTranslation } from "../ports/i18n";
import { livePins, useHomePinsStore, usePlaylistsList, useRailPinsStore, type HomePin } from "../ports/library";
import { activeNav, navigateWithTransition, type NavItem } from "./navigate";

export interface Section {
  id: NavItem;
  icon: IconName;
  label: string;
  href: string;
}

const MAX_PINS = 6;

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function useNav(): {
  sections: Section[];
  pins: HomePin[];
  active: NavItem | null;
  go: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
} {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const barPins = useRailPinsStore((state) => state.pins);
  const homePins = useHomePinsStore((state) => state.pins);
  const playlists = usePlaylistsList();
  // a failed fetch lists no playlists, so only a clean one may hide pins of deleted playlists
  const settled = playlists.isFetched && !playlists.error && !playlists.isLoading;
  const pins = [...barPins, ...homePins.filter((pin) => !barPins.some((own) => own.kind === pin.kind && own.id === pin.id))].slice(0, MAX_PINS);

  return {
    sections: [
      { id: "home", icon: "home", label: t("ui.nav.home"), href: "/" },
      { id: "library", icon: "library", label: t("ui.nav.library"), href: "/library" },
      { id: "stats", icon: "stats", label: t("ui.nav.stats"), href: "/stats" },
      { id: "recognize", icon: "recognize", label: t("ui.nav.recognize"), href: "/recognize" },
    ],
    pins: livePins(pins, settled ? playlists.data.playlists.map((playlist) => playlist.id) : null),
    active: activeNav(pathname),
    go: (event, href) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      // a pointer click must not leave the focus fill behind; Enter from the keyboard keeps focus
      if (event.detail > 0) event.currentTarget.blur();
      navigateWithTransition(navigate, href);
    },
  };
}
