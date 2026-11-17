import { useState, type JSX, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Menu } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { saveAsFiles } from "../../ports/exports";
import { useTranslation } from "../../ports/i18n";
import { revealLocalTrack } from "../../ports/localFiles";
import { playerEngine, type Track } from "../../ports/player";
import { songMenuNotInterested } from "../../recs/notInterested";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { openLyricsTool } from "../lyrics/lyricsTools";
import { trackMenuItems, type TrackMenuActions } from "./trackMenu";

interface MenuState {
  track: Track;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

export interface TrackMenu {
  open: (track: Track, anchor: HTMLElement | null, at?: { x: number; y: number }) => void;
  onContextMenu: (track: Track) => (event: MouseEvent<HTMLElement>) => void;
  isOpenFor: (track: Track) => boolean;
  element: JSX.Element;
}

/* The song menu of a list that is not a playlist: Search results and Home */
export function useTrackMenu(): TrackMenu {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [add, setAdd] = useState<{ track: Track; anchor: HTMLElement | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const actions: TrackMenuActions = {
    t,
    playNext: (track) => playerEngine.playNext(track),
    addToQueue: (track) => playerEngine.addToQueue(track),
    addToPlaylist: (track) => {
      setAdd({ track, anchor: menu?.anchor ?? null });
      setAddOpen(true);
    },
    startRadio: (track) => void playerEngine.startRadioStation(track),
    goToArtist: (artistId) => navigateWithTransition(navigate, `/artist?id=${encodeURIComponent(artistId)}`),
    goToAlbum: (albumId) => navigateWithTransition(navigate, `/collection?type=album&id=${encodeURIComponent(albumId)}`),
    editLyrics: (track) => openLyricsTool(track, "edit"),
    translateLyrics: (track) => openLyricsTool(track, "translate"),
    remove: () => undefined,
    notInterested: songMenuNotInterested,
    saveAsFile: (track) => void saveAsFiles({ trackIds: [track.id], label: track.title, playlistFile: false }),
    showInFolder: (track) => revealLocalTrack(track.id),
  };
  const open = (track: Track, anchor: HTMLElement | null, at?: { x: number; y: number }) => {
    setMenu({ track, anchor, at });
    setMenuOpen(true);
  };

  return {
    open,
    onContextMenu: (track) => (event) => {
      event.preventDefault();
      open(track, event.currentTarget, { x: event.clientX, y: event.clientY });
    },
    isOpenFor: (track) => menuOpen && menu?.track === track,
    element: (
      <>
        <Menu
          open={menuOpen}
          anchor={menu?.anchor ?? null}
          at={menu?.at}
          onClose={() => setMenuOpen(false)}
          items={menu ? trackMenuItems(menu.track, {}, actions) : []}
        />
        <Popover open={addOpen} anchor={add?.anchor ?? null} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
          {add ? <AddToPlaylistPopover track={add.track} onDone={() => setAddOpen(false)} /> : null}
        </Popover>
      </>
    ),
  };
}
