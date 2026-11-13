import { useState, type JSX, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { Explicit } from "../../components/Explicit";
import { Icon } from "../../icons/Icon";
import { Menu } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { saveAsFiles } from "../../ports/exports";
import { revealLocalTrack } from "../../ports/localFiles";
import { isSoundCloudId, playerEngine, usePlayerStore, type Track } from "../../ports/player";
import type { SearchResult } from "../../ports/search";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { formatDuration } from "../entity/entityModel";
import { MediaRow } from "../MediaRow";
import { useUnavailable } from "../entity/EntityTracks";
import { DislikeButton } from "../../recs/DislikeButton";
import { songMenuNotInterested } from "../../recs/notInterested";
import { trackMenuItems, type TrackMenuActions } from "../entity/trackMenu";
import { type GroupKey, type SearchFilter, type SearchGroups as Groups } from "./searchModel";
import styles from "./Search.module.css";
import { openLyricsTool } from "../lyrics/lyricsTools";

const GROUP_ORDER: GroupKey[] = ["songs", "albums", "artists", "playlists"];

export interface SearchGroupsProps {
  groups: Groups;
  filter: SearchFilter;
  hasMore: (key: GroupKey) => boolean;
  onShowAll: (key: GroupKey) => void;
  onActivate: (result: SearchResult) => void;
}

function subtitleOf(result: SearchResult, t: TFunction): string {
  if (result.kind === "song") return t("ui.search.kind_song", { artist: result.subtitle });
  if (result.kind === "album") return result.subtitle ? t("ui.library.kind_album", { artist: result.subtitle }) : t("ui.library.kind_album_plain");
  if (result.kind === "artist") return t("ui.library.kind_artist");
  return result.subtitle ? t("ui.library.kind_playlist", { owner: result.subtitle }) : t("ui.library.kind_playlist_plain");
}

function songBadge(result: SearchResult, t: TFunction): ReactNode {
  const track = result.track;
  if (!track) return undefined;
  const fromSoundCloud = isSoundCloudId(track.id);
  if (!track.explicit && !result.preview && !fromSoundCloud) return undefined;
  return (
    <>
      {track.explicit ? <Explicit label={t("ui.entity.explicit")} /> : null}
      {result.preview ? (
        <span className={styles.preview} title={t("ui.search.preview_hint")}>
          {t("ui.search.preview")}
        </span>
      ) : null}
      {fromSoundCloud ? (
        <span role="img" className={styles.source} aria-label={t("ui.search.from_soundcloud")} title={t("ui.search.from_soundcloud")}>
          <Icon name="soundcloud" size={16} />
        </span>
      ) : null}
    </>
  );
}

interface MenuState {
  track: Track;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

function SongRows({ songs, onActivate }: { songs: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const tracks = songs.map((song) => song.track!);
  const unavailable = useUnavailable(tracks);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [add, setAdd] = useState<{ track: Track; anchor: HTMLElement | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const openAddToPlaylist = (track: Track, anchor: HTMLElement | null) => {
    setAdd({ track, anchor });
    setAddOpen(true);
  };
  const actions: TrackMenuActions = {
    t,
    playNext: (track) => playerEngine.playNext(track),
    addToQueue: (track) => playerEngine.addToQueue(track),
    addToPlaylist: (track) => openAddToPlaylist(track, menu?.anchor ?? null),
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
  const openMenu = (track: Track, anchor: HTMLElement | null, at?: { x: number; y: number }) => {
    setMenu({ track, anchor, at });
    setMenuOpen(true);
  };

  return (
    <>
      <div className={styles.rows}>
        {songs.map((song) => {
          const track = song.track!;
          const selected = menuOpen && menu?.track === track;
          return (
            <MediaRow
              key={song.id}
              data-selected={selected ? "" : undefined}
              leading={<Cover src={song.cover} size={48} radius={8} fetchPriority="low" />}
              title={song.title}
              badge={songBadge(song, t)}
              subtitle={song.subtitle}
              meta={formatDuration(track.durationMs)}
              extra={<DislikeButton track={track} />}
              active={track.id === currentId}
              unavailableReason={unavailable(track) ?? undefined}
              onActivate={() => onActivate(song)}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(track, event.currentTarget, { x: event.clientX, y: event.clientY });
              }}
              menuLabel={t("ui.entity.more")}
              onMenu={(anchor) => openMenu(track, anchor)}
            />
          );
        })}
      </div>
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
  );
}

function EntityCover({ result }: { result: SearchResult }) {
  return <Cover src={result.cover} size={48} radius={8} shape={result.kind === "artist" ? "circle" : "square"} fetchPriority="low" />;
}

function EntityRows({ results, onActivate }: { results: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  return (
    <div className={styles.rows}>
      {results.map((result) => (
        <MediaRow
          key={`${result.kind}:${result.id}`}
          leading={<EntityCover result={result} />}
          title={result.title}
          subtitle={result.subtitle || undefined}
          onActivate={() => onActivate(result)}
        />
      ))}
    </div>
  );
}

export function SearchGroups({ groups, filter, hasMore, onShowAll, onActivate }: SearchGroupsProps): JSX.Element {
  const { t } = useTranslation();
  const top = groups.top;

  const section = (key: GroupKey) => {
    const results = groups[key];
    if (results.length === 0) return null;
    const title = t(`ui.search.tab_${key}`);
    return (
      <section key={key} className={styles.group} aria-label={title}>
        <h2 className={styles.heading}>{title}</h2>
        {key === "songs" ? <SongRows songs={results} onActivate={onActivate} /> : <EntityRows results={results} onActivate={onActivate} />}
        {filter === "all" && hasMore(key) ? (
          <button type="button" className={styles.more} onClick={() => onShowAll(key)}>
            {t("ui.search.show_all")}
          </button>
        ) : null}
      </section>
    );
  };

  return (
    <>
      {top ? (
        <section className={styles.group} aria-label={t("ui.search.top")}>
          <h2 className={styles.heading}>{t("ui.search.top")}</h2>
          <div className={styles.rows}>
            <MediaRow
              data-top=""
              leading={<EntityCover result={top} />}
              title={top.title}
              badge={songBadge(top, t)}
              subtitle={subtitleOf(top, t)}
              extra={top.track ? <DislikeButton track={top.track} /> : undefined}
              onActivate={() => onActivate(top)}
            />
          </div>
        </section>
      ) : null}
      {section("songs")}
      {GROUP_ORDER.filter((key) => key !== "songs").map(section)}
    </>
  );
}
