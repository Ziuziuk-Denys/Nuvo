import { useMemo, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { Menu } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { Icon } from "../../icons/Icon";
import { saveAsFiles } from "../../ports/exports";
import { useTranslation } from "../../ports/i18n";
import { revealLocalTrack } from "../../ports/localFiles";
import { playerEngine, usePlayerStore, type Track } from "../../ports/player";
import { rowTrack, type StatsRow } from "../../ports/stats";
import { songMenuNotInterested } from "../../recs/notInterested";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { useUnavailable } from "../entity/EntityTracks";
import { trackMenuItems, type TrackMenuActions } from "../entity/trackMenu";
import { openLyricsTool } from "../lyrics/lyricsTools";
import { MediaRow } from "../MediaRow";
import styles from "./Stats.module.css";

export const trackHref = (id: string) => `/stats/track?id=${encodeURIComponent(id)}`;
export const artistHref = (key: string) => `/stats/artist?key=${encodeURIComponent(key)}`;

const CONTEXT = "stats";

function Move({ row }: { row: StatsRow }): JSX.Element | null {
  const { t } = useTranslation();
  if (row.isNew) return <span className={styles.move}>{t("ui.stats.new")}</span>;
  if (!row.rankDelta) return null;
  const up = row.rankDelta > 0;
  return (
    <span className={styles.move} aria-label={t(up ? "ui.stats.rank_up" : "ui.stats.rank_down", { count: Math.abs(row.rankDelta) })}>
      <Icon name={up ? "chevron-up" : "chevron-down"} size={16} />
      {Math.abs(row.rankDelta)}
    </span>
  );
}

interface MenuState {
  track: Track;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

export function useSongMenu(): {
  open(track: Track, anchor: HTMLElement | null, at?: { x: number; y: number }): void;
  layers: JSX.Element;
} {
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
  return {
    open: (track, anchor, at) => {
      setMenu({ track, anchor, at });
      setMenuOpen(true);
    },
    layers: (
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

export interface SongRowsProps {
  rows: readonly StatsRow[];
  meta: (row: StatsRow) => string;
  ranked?: boolean;
}

export function SongRows({ rows, meta, ranked = false }: SongRowsProps): JSX.Element {
  const { t } = useTranslation();
  const currentId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const list = useMemo(
    () =>
      rows.flatMap((row) => {
        const track = rowTrack(row.track);
        return track ? [{ row, track }] : [];
      }),
    [rows],
  );
  const tracks = useMemo(() => list.map((item) => item.track), [list]);
  const unavailable = useUnavailable(tracks);
  const menu = useSongMenu();
  const playable = tracks.filter((track) => unavailable(track) === null);
  return (
    <div className={styles.rows}>
      {list.map(({ row, track }) => (
        <div key={row.id} className={styles.rankedRow} data-stats-row="">
          {ranked ? <span className={styles.rank}>{row.rank}</span> : null}
          <MediaRow
            className={styles.mediaRow}
            leading={
              <button
                type="button"
                className={styles.playCover}
                aria-label={t("ui.stats.play_song", { title: row.title })}
                disabled={unavailable(track) !== null}
                onClick={(event) => {
                  event.stopPropagation();
                  void playerEngine.playTrack(track, playable, CONTEXT, "");
                }}
              >
                <Cover src={row.coverUrl ?? ""} size={48} radius={8} fetchPriority="low" />
                <span className={styles.playGlyph}>
                  <Icon name="play" size={20} />
                </span>
              </button>
            }
            title={row.title}
            subtitle={row.subtitle}
            meta={meta(row)}
            extra={ranked ? <Move row={row} /> : undefined}
            active={track.id === currentId}
            onActivate={unavailable(track) === null ? () => void playerEngine.playTrack(track, playable, CONTEXT, "") : undefined}
            onContextMenu={(event) => {
              event.preventDefault();
              menu.open(track, event.currentTarget, { x: event.clientX, y: event.clientY });
            }}
            menuLabel={t("ui.entity.more")}
            onMenu={(anchor) => menu.open(track, anchor)}
          />
        </div>
      ))}
      {menu.layers}
    </div>
  );
}

export function GroupRows({
  rows,
  meta,
  shape,
  open,
}: {
  rows: readonly StatsRow[];
  meta: (row: StatsRow) => string;
  shape?: "circle";
  open?: (row: StatsRow) => string | null;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className={styles.rows}>
      {rows.map((row) => {
        const href = open?.(row) ?? null;
        return (
          <div key={row.id} className={styles.rankedRow} data-stats-row="">
            <span className={styles.rank}>{row.rank}</span>
            <MediaRow
              className={styles.mediaRow}
              leading={<Cover src={row.coverUrl ?? ""} size={48} shape={shape} radius={shape ? undefined : 8} fetchPriority="low" />}
              title={row.title}
              subtitle={row.subtitle}
              meta={meta(row)}
              extra={<Move row={row} />}
              onActivate={href ? () => navigateWithTransition(navigate, href) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
