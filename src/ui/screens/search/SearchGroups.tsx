import { useState, type JSX, type KeyboardEvent, type ReactNode } from "react";
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
import { subtitleOf, type GroupKey, type SearchFilter, type SearchGroups as Groups } from "./searchModel";
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

// albums, artists and playlists spread into columns like Home's songs; songs keep one column for their times
function EntityRows({ results, onActivate }: { results: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  return (
    <div className={styles.columns}>
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

function TopCard({ top, onActivate }: { top: SearchResult; onActivate: (result: SearchResult) => void }) {
  const { t } = useTranslation();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (!event.repeat) onActivate(top);
  };
  return (
    <div role="button" tabIndex={0} data-top="" className={styles.top} onClick={() => onActivate(top)} onKeyDown={onKeyDown}>
      <Cover src={top.cover} size={112} radius={10} shape={top.kind === "artist" ? "circle" : "square"} fetchPriority="high" />
      <span className={styles.topText}>
        <span className={styles.topLine}>
          <span className={styles.topTitle}>{top.title}</span>
          {songBadge(top, t)}
        </span>
        <span className={styles.topSubtitle}>{subtitleOf(top, t)}</span>
      </span>
      {top.track ? (
        <span className={styles.topEnd} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <DislikeButton track={top.track} />
        </span>
      ) : null}
    </div>
  );
}

export function SearchGroups({ groups, filter, hasMore, onShowAll, onActivate }: SearchGroupsProps): JSX.Element {
  const { t } = useTranslation();
  const top = groups.top;
  const all = filter === "all";

  const section = (key: GroupKey) => {
    const results = groups[key];
    if (results.length === 0) return null;
    const title = t(`ui.search.tab_${key}`);
    return (
      <section key={key} className={styles.group} aria-label={title}>
        <div className={styles.headingLine}>
          <h2 className={styles.heading}>{title}</h2>
          {all && hasMore(key) ? (
            <button type="button" className={styles.more} onClick={() => onShowAll(key)}>
              {t("ui.search.show_all")}
            </button>
          ) : null}
        </div>
        {key === "songs" ? <SongRows songs={results} onActivate={onActivate} /> : <EntityRows results={results} onActivate={onActivate} />}
      </section>
    );
  };

  return (
    <>
      {top ? (
        <div className={styles.lead}>
          <section className={styles.group} aria-label={t("ui.search.top")}>
            <div className={styles.headingLine}>
              <h2 className={styles.heading}>{t("ui.search.top")}</h2>
            </div>
            <TopCard top={top} onActivate={onActivate} />
          </section>
          {section("songs")}
        </div>
      ) : (
        section("songs")
      )}
      {GROUP_ORDER.filter((key) => key !== "songs").map(section)}
    </>
  );
}
