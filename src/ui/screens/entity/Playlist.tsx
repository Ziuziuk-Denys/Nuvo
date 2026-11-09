import { playlistHref } from "../../app/hrefs";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { EmptyState } from "../../components/EmptyState";
import { Menu, type MenuItem } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation, type TFunction } from "../../ports/i18n";
import {
  useLikedTracks,
  useLikeTrack,
  useUnlikeTrack,
  useLikesCover,
  useModalStore,
  savePlaylistDescription,
  usePlaylist,
  useReorderPlaylistTracks,
  addTrackToPlaylist,
  setPlaylistSort,
  keepPlaylistOffline,
  useOfflineProgress,
  type PlaylistSort,
} from "../../ports/library";
import { exportDocument, saveAsFiles } from "../../ports/exports";
import { revealLocalTrack } from "../../ports/localFiles";
import { playerEngine, usePlayerStore, type Track } from "../../ports/player";
import {
  mergeWithUndo,
  moveWithUndo,
  pickPlaylistCover,
  removePlaylistCover,
  removeWithUndo,
  setPlaylistCover,
  type TidyTexts,
} from "../../ports/playlistTools";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { PlaylistPicker } from "../../shell/popovers/PlaylistPicker";
import { Sheet } from "../../components/Sheet";
import { Toggle } from "../../components/Toggle";
import { LikedTile } from "../home/LikedTile";
import look from "../look.module.css";
import { SearchField } from "../SearchField";
import { duplicateGroups } from "./duplicates";
import { DuplicatesSheet } from "./DuplicatesSheet";
import { EntityHead, Facts } from "./EntityHead";
import { EntityLoading, EntityPage } from "./EntityPage";
import { entityPlayback, useUnavailable } from "./EntityTracks";
import { formatTotal, formatUpdated, matchTracks, moveTarget, orderTracks, totalMs, type TrackOrder } from "./entityModel";
import { songMenuNotInterested } from "../../recs/notInterested";
import { PlaylistSuggestions } from "../../recs/PlaylistSuggestions";
import { setPlaylistExcluded, useExcludedPlaylists } from "../../ports/recs";
import { shareItemOf, useShareSheet } from "../../sheets/ShareSheet";
import { trackMenuItems, type TrackMenuActions } from "./trackMenu";
import { usePinItems } from "./entityActions";
import { TrackList, trackKey } from "./TrackList";
import { TrackBulkBar } from "./TrackBulkBar";
import { useTrackSelection } from "./trackSelection";
import pageStyles from "./EntityPage.module.css";
import { openLyricsTool } from "../lyrics/lyricsTools";

const SORTS: TrackOrder[] = ["default", "title", "duration"];
const PLAYLIST_SORTS: PlaylistSort[] = ["manual", "added", "title", "artist", "album", "duration"];
const sortLabel = (mode: PlaylistSort) => `ui.entity.sort_${mode === "manual" ? "default" : mode}`;

interface PlaylistData {
  title: string;
  description?: string;
  cover: string;
  tracks: Track[];
  revision: number;
  customCover: boolean;
  sortMode?: PlaylistSort;
  keptOffline?: boolean;
  updatedAt?: string;
}

function usePlaylistData(id: string | null, liked: boolean, t: TFunction): { data: PlaylistData | null; loading: boolean } {
  const playlist = usePlaylist(liked ? null : id);
  const likes = useLikedTracks();
  const likesCover = useLikesCover();
  return useMemo(() => {
    if (liked) {
      return {
        data: { title: t("ui.library.liked"), cover: likesCover ?? "", tracks: likes.data.tracks, revision: 0, customCover: false },
        loading: likes.isLoading && likes.data.tracks.length === 0,
      };
    }
    const detail = playlist.data;
    if (!detail) return { data: null, loading: playlist.isLoading };
    return {
      data: {
        title: detail.title || t("ui.entity.untitled"),
        description: detail.description || undefined,
        cover: detail.coverUrl || detail.coverUrls?.[0] || "",
        tracks: detail.tracks,
        revision: detail.revision,
        customCover: Boolean(detail.coverUrl),
        sortMode: detail.sortMode,
        keptOffline: detail.pinnedOffline,
        updatedAt: detail.updatedAt,
      },
      loading: false,
    };
  }, [liked, likes, likesCover, playlist, t]);
}

function DescriptionLine({ id, text, editing, onEditing }: { id: string; text?: string; editing: boolean; onEditing(editing: boolean): void }): JSX.Element {
  const { t } = useTranslation();
  if (!editing) {
    return (
      <button type="button" onClick={() => onEditing(true)}>
        {text || t("common.add_description")}
      </button>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={text ?? ""}
      aria-label={t(text ? "common.edit_description" : "common.add_description")}
      maxLength={300}
      onBlur={(event) => {
        onEditing(false);
        const next = event.currentTarget.value.trim();
        // a failed save toasts from the api layer; the old text stays
        if (next !== (text ?? "")) void savePlaylistDescription(id, next).catch(() => undefined);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.value = text ?? "";
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface TrackMenuState {
  track: Track;
  key: string;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

export function Playlist(): JSX.Element {
  const [params] = useSearchParams();
  const id = params.get("id");
  return <PlaylistPage key={id ?? ""} id={id} />;
}

function PlaylistPage({ id }: { id: string | null }): JSX.Element {
  const { t, locale } = useTranslation();
  const liked = id === "likes";
  const navigate = useNavigate();
  const { data, loading } = usePlaylistData(id, liked, t);
  const reorder = useReorderPlaylistTracks();
  const [optimistic, setOptimistic] = useState<Track[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TrackOrder>("default");
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  // the last menu and add target stay set while they fade out; the flags say whether they are up
  const [menu, setMenu] = useState<TrackMenuState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [add, setAdd] = useState<{ track: Track; tracks?: Track[]; anchor: HTMLElement | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [deleteAfterMerge, setDeleteAfterMerge] = useState(false);
  const revision = useRef(0);
  const moves = useRef<Promise<void>>(Promise.resolve());
  const pendingMoves = useRef(0);
  const deferredQuery = useDeferredValue(query);

  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const status = usePlayerStore((state) => state.status);

  // Server order wins on a new revision, but not under queued moves: it would flash the old order
  useEffect(() => {
    if (pendingMoves.current === 0) setOptimistic(null);
    revision.current = Math.max(revision.current, data?.revision ?? 0);
  }, [data?.revision]);

  const own = !liked && id !== null;
  const context = liked ? "playlist:likes" : `playlist:${id}`;
  const cover = data?.cover ?? "";
  usePageBackdrop(cover || undefined);

  const source = optimistic ?? data?.tracks ?? [];
  const sortMode = own ? (data?.sortMode ?? "manual") : null;
  const sorted = useMemo(() => orderTracks(source, own ? "default" : sort), [source, own, sort]);
  const matches = useMemo(() => matchTracks(sorted, deferredQuery), [sorted, deferredQuery]);
  const shown = useMemo(() => matches ?? sorted.map((track, index) => ({ track, index })), [matches, sorted]);
  const filtering = matches !== null;
  const selection = useTrackSelection(shown.map(trackKey));
  const picked = shown.filter((match) => selection.keys.has(trackKey(match))).map((match) => match.track);
  const likeTrack = useLikeTrack();
  const unlikeTrack = useUnlikeTrack();
  const trackIds = useMemo(() => (data?.tracks ?? []).map((track) => track.id), [data?.tracks]);

  const pinItems = usePinItems(
    {
      kind: "playlist",
      id: id ?? "",
      title: data?.title ?? "",
      subtitle: t("ui.library.kind_playlist", { owner: t("ui.library.you") }),
      imageUrl: cover || undefined,
      href: playlistHref(id ?? ""),
      trackCount: data?.tracks.length,
    },
    t,
  );

  const unavailable = useUnavailable(source);
  const kept = own && data?.keptOffline === true;
  const offline = useOfflineProgress(own ? id : null, kept);
  const excluded = useExcludedPlaylists()?.includes(id ?? "") === true;
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const groups = useMemo(() => (own ? duplicateGroups(data?.tracks ?? []) : []), [own, data?.tracks]);
  // only tracks with no catalog id: offline tracks are fine and come back when the network does
  const unavailableIds = own ? (data?.tracks ?? []).flatMap((track) => (!track.id && track.playlistItemId ? [track.playlistItemId] : [])) : [];
  const tidyTexts: TidyTexts = {
    removed: t("ui.library.tidy_removed"),
    undo: t("ui.library.undo"),
    undoFailed: t("ui.library.undo_failed"),
    undoPartial: t("ui.library.undo_partial"),
    failed: t("ui.library.tidy_failed"),
  };
  const undoTexts = { undo: t("ui.library.undo"), undoFailed: t("ui.library.undo_failed") };
  const moveTo = (targetId: string, title: string) => {
    const itemIds = picked.flatMap((track) => (track.playlistItemId ? [track.playlistItemId] : []));
    setMoveOpen(false);
    selection.clear();
    if (id) void moveWithUndo(id, itemIds, targetId, { ...undoTexts, done: t("ui.library.moved", { title }), failed: t("ui.library.move_failed") });
  };
  const mergeInto = (targetId: string, title: string) => {
    setMerging(false);
    if (!id) return;
    const texts = { ...undoTexts, done: () => t("ui.library.merged", { title }), failed: t("ui.library.merge_failed") };
    void mergeWithUndo(id, targetId, deleteAfterMerge, texts).then((merged) => {
      if (merged && deleteAfterMerge) navigateWithTransition(navigate, playlistHref(targetId));
    });
  };
  const { play: playTrack, playAll, shuffle, playable } = entityPlayback(sorted, unavailable, context, cover);
  const play = (index: number) => {
    const track = sorted[index];
    if (track) playTrack(track);
  };

  // moves run one after another, each on the revision the last one returned
  const move = (from: number, to: number) => {
    const list = optimistic ?? data?.tracks ?? [];
    const moving = list[from];
    if (!id || !moving?.playlistItemId) return;
    const { next, before } = moveTarget(list, from, to);
    setOptimistic(next);
    pendingMoves.current += 1;
    const input = { playlistId: id, itemId: moving.playlistItemId, beforeItemId: before?.playlistItemId ?? null };
    moves.current = moves.current
      .then(async () => {
        const result = await reorder.mutateAsync({ ...input, revision: revision.current });
        revision.current = result.playlist.revision;
      })
      .catch(() => setOptimistic(null))
      .finally(() => {
        pendingMoves.current -= 1;
      });
  };

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
    remove: (track) =>
      useModalStore.getState().openRemoveFromPlaylist({
        trackId: track.id,
        playlistItemId: track.playlistItemId,
        trackTitle: track.title,
        trackArtists: track.artists,
        trackCoverUrl: track.coverUrl,
        playlistId: id ?? undefined,
        playlistTitle: data?.title,
      }),
    notInterested: songMenuNotInterested,
    saveAsFile: (track) => void saveAsFiles({ trackIds: [track.id], label: track.title, playlistFile: false }),
    showInFolder: (track) => revealLocalTrack(track.id),
  };

  const changeCover = async (playlistId: string) => {
    const image = await pickPlaylistCover();
    if (image) await setPlaylistCover(playlistId, image, t("ui.library.cover_failed"));
  };

  const entityMenu: MenuItem[] =
    !id || liked || !data
      ? []
      : [
          ...pinItems,
          {
            label: t(kept ? "ui.library.offline_stop" : "ui.library.offline_keep"),
            onSelect: () => void keepPlaylistOffline(id, !kept).catch(() => undefined),
          },
          {
            label: t(excluded ? "ui.recs.excluded.include" : "ui.recs.excluded.exclude"),
            onSelect: () => void setPlaylistExcluded(id, !excluded).catch(() => undefined),
          },
          { label: t(data.description ? "common.edit_description" : "common.add_description"), onSelect: () => setEditingDescription(true) },
          {
            label: t("ui.links.share.title"),
            disabled: data.tracks.length === 0,
            onSelect: () => useShareSheet.getState().show(data.title, data.tracks.map(shareItemOf)),
          },
          { label: t("ui.library.find_duplicates"), onSelect: () => setDuplicatesOpen(true) },
          {
            label: t("ui.library.merge"),
            disabled: data.tracks.length === 0,
            onSelect: () => {
              setDeleteAfterMerge(false);
              setMerging(true);
            },
          },
          {
            label: t("ui.library.remove_unavailable", { value: unavailableIds.length }),
            disabled: unavailableIds.length === 0,
            onSelect: () => void removeWithUndo(id, unavailableIds, tidyTexts),
          },
          { label: t("ui.library.change_cover"), onSelect: () => void changeCover(id) },
          ...(data.customCover ? [{ label: t("ui.library.remove_cover"), onSelect: () => void removePlaylistCover(id).catch(() => undefined) }] : []),
          "separator",
          { label: t("ui.export.save_files"), onSelect: () => void saveAsFiles({ playlistId: id, label: data.title, playlistFile: true }) },
          { label: t("ui.export.export_m3u8"), onSelect: () => void exportDocument({ kind: "playlist", id, title: data.title, format: "m3u8" }) },
          { label: t("ui.export.export_csv"), onSelect: () => void exportDocument({ kind: "playlist", id, title: data.title, format: "csv" }) },
          { label: t("ui.export.export_json"), onSelect: () => void exportDocument({ kind: "playlist", id, title: data.title, format: "json" }) },
          "separator",
          {
            label: t("ui.library.delete_playlist"),
            danger: true,
            onSelect: () => useModalStore.getState().openRemoveFromLibrary({ id, title: data.title, coverUrl: cover, type: "playlist", isOwned: true }),
          },
        ];

  if (!data && loading) return <EntityLoading kind="playlist" />;

  if (!data) {
    return (
      <EmptyState
        title={t("ui.entity.not_found_title")}
        message={t("ui.entity.not_found_message")}
        actions={[{ label: t("ui.entity.back_to_library"), primary: true, onClick: () => navigateWithTransition(navigate, "/library") }]}
      />
    );
  }

  const count = data.tracks.length;
  const search = <SearchField value={query} onChange={setQuery} placeholder={t("track_search.placeholder_playlist")} clearLabel={t("ui.clear")} />;
  const sortButton = (
    <button
      type="button"
      className={`${look.pill} ${look.glass} ${look.square}`}
      aria-label={t(sortMode ? sortLabel(sortMode) : `ui.entity.sort_${sort}`)}
      aria-haspopup="menu"
      aria-expanded={sortAnchor !== null}
      disabled={count < 2}
      onClick={(event) => setSortAnchor(sortAnchor ? null : event.currentTarget)}
    >
      <Icon name="sort-lines" size={16} />
    </button>
  );

  let empty: JSX.Element | undefined;
  if (count === 0) {
    empty = (
      <div className={pageStyles.state}>
        <Icon name="playlist" size={26} className={pageStyles.stateIcon} />
        <p className={pageStyles.stateTitle}>{t(liked ? "playlist.likes_empty" : "playlist.empty_title")}</p>
        {liked ? null : (
          <button type="button" className={pageStyles.stateAction} onClick={() => useModalStore.getState().openSearch()}>
            {t("playlist.empty_subtitle")}
          </button>
        )}
      </div>
    );
  } else if (filtering && shown.length === 0) {
    empty = (
      <div className={pageStyles.state}>
        <Icon name="search" size={24} className={pageStyles.stateIcon} />
        <p className={pageStyles.stateTitle}>{t("ui.library.no_match", { query: deferredQuery.trim() })}</p>
        <button type="button" className={look.sectionLink} onClick={() => setQuery("")}>
          {t("ui.library.clear_filter")}
        </button>
      </div>
    );
  }

  const updated = own ? formatUpdated(data.updatedAt, locale) : undefined;

  return (
    <>
      <EntityPage
        kind="playlist"
        head={
          <EntityHead
            cover={liked ? <LikedTile /> : cover ? <Cover src={cover} size={168} alt="" /> : <Icon name="playlist" size={24} className={pageStyles.glyph} />}
            title={data.title}
            description={own ? <DescriptionLine id={id} text={data.description} editing={editingDescription} onEditing={setEditingDescription} /> : undefined}
            chips={
              <>
                <Facts
                  count={t("common.tracks", { count })}
                  length={formatTotal(totalMs(data.tracks), t)}
                  updated={updated && t("ui.entity.updated", { when: updated })}
                />
                {kept && offline ? (
                  <span className={look.chip} data-offline-progress="">
                    <Icon name="downloaded" size={16} />
                    <span>
                      {offline.cached < offline.total
                        ? t("ui.library.offline_progress", { cached: offline.cached, total: offline.total })
                        : t("ui.library.offline_ready")}
                    </span>
                  </span>
                ) : null}
              </>
            }
            onPlay={playAll}
            onShuffle={shuffle}
            onQueue={() => playable.forEach((track) => playerEngine.addToQueue(track))}
            menu={entityMenu}
            search={search}
            sort={sortButton}
            idle={playable.length === 0}
          />
        }
        empty={empty}
        tracks={
          <>
            <TrackList
              tracks={shown}
              currentId={currentTrack?.id ?? null}
              playing={status === "playing" || status === "loading"}
              onPlay={play}
              unavailable={unavailable}
              onTogglePlay={() => playerEngine.togglePlayPause()}
              onReorder={own && sortMode === "manual" && !filtering ? move : undefined}
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
                picked.forEach((track) => likeTrack.mutate(track));
                selection.clear();
              }}
              onQueue={() => {
                picked.forEach((track) => playerEngine.addToQueue(track));
                selection.clear();
              }}
              onRemove={
                liked
                  ? () => {
                      picked.forEach((track) => unlikeTrack.mutate(track.id));
                      selection.clear();
                    }
                  : own
                    ? () => {
                        const itemIds = picked.flatMap((track) => (track.playlistItemId ? [track.playlistItemId] : []));
                        selection.clear();
                        void removeWithUndo(id, itemIds, tidyTexts);
                      }
                    : undefined
              }
              onMove={
                own
                  ? (anchor) => {
                      setMoveAnchor(anchor);
                      setMoveOpen(true);
                    }
                  : undefined
              }
              onClear={selection.clear}
            />
            {own ? <PlaylistSuggestions playlistId={id} trackIds={trackIds} onAdd={(track) => addTrackToPlaylist(id, track)} /> : null}
          </>
        }
      />
      <Menu
        open={sortAnchor !== null}
        anchor={sortAnchor}
        onClose={() => setSortAnchor(null)}
        items={
          own && id
            ? PLAYLIST_SORTS.map((mode) => ({ label: t(sortLabel(mode)), onSelect: () => void setPlaylistSort(id, mode).catch(() => undefined) }))
            : SORTS.map((key) => ({ label: t(`ui.entity.sort_${key}`), onSelect: () => setSort(key) }))
        }
      />
      <Menu
        open={menuOpen}
        anchor={menu?.anchor ?? null}
        at={menu?.at}
        onClose={() => setMenuOpen(false)}
        items={menu ? trackMenuItems(menu.track, { playlistId: own ? (id ?? undefined) : undefined }, actions) : []}
      />
      <Popover open={addOpen} anchor={add?.anchor ?? null} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
        {add ? <AddToPlaylistPopover track={add.track} tracks={add.tracks} onDone={() => setAddOpen(false)} /> : null}
      </Popover>
      <Popover open={moveOpen} anchor={moveAnchor} onClose={() => setMoveOpen(false)} title={t("ui.library.move_to")} width={320}>
        {id ? <PlaylistPicker exclude={id} onPick={moveTo} /> : null}
      </Popover>
      <Sheet
        open={merging}
        onClose={() => setMerging(false)}
        title={t("ui.library.merge")}
        actions={[{ label: t("common.cancel"), onClick: () => setMerging(false) }]}
      >
        <Toggle checked={deleteAfterMerge} onChange={setDeleteAfterMerge} label={t("ui.library.merge_delete", { title: data.title })} />
        {id ? <PlaylistPicker exclude={id} onPick={mergeInto} /> : null}
      </Sheet>
      <DuplicatesSheet
        open={duplicatesOpen}
        groups={groups}
        onClose={() => setDuplicatesOpen(false)}
        onRemove={(itemIds) => {
          setDuplicatesOpen(false);
          if (id) void removeWithUndo(id, itemIds, tidyTexts);
        }}
      />
    </>
  );
}
