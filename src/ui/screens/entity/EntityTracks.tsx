import { useMemo, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Menu } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { useLikeTrack } from "../../ports/library";
import { useCachedTrackIds } from "../../ports/catalog";
import { useTranslation } from "../../ports/i18n";
import { useOfflineMode, useOnline, useStreamingReachable } from "../../ports/network";
import { saveAsFiles } from "../../ports/exports";
import { revealLocalTrack } from "../../ports/localFiles";
import { isSoundCloudId, playerEngine, usePlayerStore, type Track } from "../../ports/player";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import type { TrackMatch } from "./entityModel";
import { songMenuNotInterested } from "../../recs/notInterested";
import { trackMenuItems, type TrackMenuActions } from "./trackMenu";
import { TrackList, trackKey } from "./TrackList";
import { TrackBulkBar } from "./TrackBulkBar";
import { useTrackSelection } from "./trackSelection";
import { openLyricsTool } from "../lyrics/lyricsTools";

export type Unavailable = (track: Track) => string | null;

export function useUnavailable(tracks: readonly Track[]): Unavailable {
  const { t } = useTranslation();
  const offlineMode = useOfflineMode();
  const online = useStreamingReachable() && !offlineMode;
  const soundCloudOnline = useOnline() && !offlineMode;
  const ids = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const cached = useCachedTrackIds(ids, !online);
  return (track) => {
    if (!track.id) return t("ui.entity.unavailable");
    if (soundCloudOnline && isSoundCloudId(track.id)) return null;
    if (cached && !cached.has(track.id)) return t(offlineMode ? "ui.entity.unavailable_offline_mode" : "ui.entity.unavailable_offline");
    return null;
  };
}

export function entityPlayback(tracks: readonly Track[], unavailable: Unavailable, context: string, cover: string) {
  const playable = tracks.filter((track) => unavailable(track) === null);
  return {
    playable,
    play: (track: Track) => void playerEngine.playTrack(track, playable, context, cover),
    playAll: () => {
      if (playable.length === 0) return;
      playerEngine.clearQueue();
      void playerEngine.playTrack(playable[0], playable, context, cover);
    },
    shuffle: () => {
      if (playable.length === 0) return;
      playerEngine.clearQueue();
      void playerEngine.playShuffled(playable, context, cover);
    },
  };
}

interface MenuState {
  track: Track;
  key: string;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

export interface EntityTracksProps {
  shown: TrackMatch<Track>[];
  tracks: readonly Track[];
  unavailable: Unavailable;
  onPlay: (track: Track) => void;
  numbered?: boolean;
  hideArtists?: boolean;
}

export function EntityTracks({ shown, tracks, unavailable, onPlay, numbered, hideArtists }: EntityTracksProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const status = usePlayerStore((state) => state.status);
  // the last menu and add target stay set while they fade out; the flags say whether they are up
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [add, setAdd] = useState<{ track: Track; tracks?: Track[]; anchor: HTMLElement | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const selection = useTrackSelection(shown.map(trackKey));
  const picked = shown.filter((match) => selection.keys.has(trackKey(match))).map((match) => match.track);
  const like = useLikeTrack();

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

  return (
    <>
      <TrackList
        tracks={shown}
        numbered={numbered}
        hideArtists={hideArtists}
        currentId={currentTrack?.id ?? null}
        playing={status === "playing" || status === "loading"}
        onPlay={(index) => {
          const track = tracks[index];
          if (track) onPlay(track);
        }}
        onTogglePlay={() => playerEngine.togglePlayPause()}
        unavailable={unavailable}
        selection={selection}
        selectedKey={menu && menuOpen ? menu.key : null}
        onMenu={(track, anchor, at) => {
          const match = shown.find((item) => item.track === track);
          setMenu({ track, key: match ? trackKey(match) : track.id, anchor, at });
          setMenuOpen(true);
        }}
      />
      <TrackBulkBar
        count={picked.length}
        onAddToPlaylist={(anchor) => {
          setAdd({ track: picked[0], tracks: picked, anchor });
          setAddOpen(true);
        }}
        onLike={() => {
          picked.forEach((track) => like.mutate(track));
          selection.clear();
        }}
        onQueue={() => {
          picked.forEach((track) => playerEngine.addToQueue(track));
          selection.clear();
        }}
        onClear={selection.clear}
      />
      <Menu
        open={menuOpen}
        anchor={menu?.anchor ?? null}
        at={menu?.at}
        onClose={() => setMenuOpen(false)}
        items={menu ? trackMenuItems(menu.track, {}, actions) : []}
      />
      <Popover open={addOpen} anchor={add?.anchor ?? null} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
        {add ? <AddToPlaylistPopover track={add.track} tracks={add.tracks} onDone={() => setAddOpen(false)} /> : null}
      </Popover>
    </>
  );
}
