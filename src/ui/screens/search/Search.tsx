import { playlistHref } from "../../app/hrefs";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Enter } from "../../components/Enter";
import { Menu, type MenuItem } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { useToastStore } from "../../feedback/toastStore";
import { useCalmLight } from "../../field/calm";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import { useTranslation } from "../../ports/i18n";
import { useLikeTrack, useLikedTracks, usePlaylistsList } from "../../ports/library";
import { createLinkPorts, routeLink, youtubeCatalog, type Share } from "../../ports/links";
import { openExternal } from "../../ports/system";
import { toPlayerTrack, useLocalTracks } from "../../ports/localFiles";
import { useOfflineMode, useOnline, useStreamingReachable } from "../../ports/network";
import { playerEngine, type Track } from "../../ports/player";
import {
  loadSearchHistory,
  songResult,
  soundCloudResult,
  toSearchResult,
  useSearchAlbums,
  useSearchAll,
  useSearchArtists,
  useSearchHistoryStore,
  useSearchPlaylists,
  useSearchTracks,
  useRankedSongs,
  useSoundCloudSearch,
  type SearchHistoryItem,
  type SearchResult,
} from "../../ports/search";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { useImportsUi } from "../imports/importsUi";
import { MediaRowPlaceholder } from "../MediaRow";
import { LinkBlock } from "./LinkBlock";
import { SharePreview } from "./SharePreview";
import {
  GROUP_KIND,
  groupResults,
  isEmpty,
  LOCAL_SEARCH_LIMIT,
  localResults,
  SEARCH_SOURCES,
  withLocalFiles,
  songsToRank,
  withSoundCloud,
  type GroupKey,
  type SearchFilter,
  type SearchSource,
} from "./searchModel";
import { SearchGroups } from "./SearchGroups";
import { SearchHistory } from "./SearchHistory";
import styles from "./Search.module.css";

const CACHE_TTL_MS = 60_000;
const DEBOUNCE_MS = 320;
const LIMIT = 20;
const SLOW_MS = 300;
const PLACEHOLDER_ROWS = 5;

const FILTER_PILLS: { id: SearchFilter; icon: IconName }[] = [
  { id: "all", icon: "grid" },
  { id: "songs", icon: "track" },
  { id: "artists", icon: "artist" },
  { id: "albums", icon: "album" },
  { id: "playlists", icon: "playlist" },
];

const SOURCE_ICONS: Record<SearchSource, IconName> = { all: "filter", youtube: "youtube", soundcloud: "soundcloud" };

const lastQuery = { text: "", leftAt: 0 };
const resultCache = new Map<string, SearchResult[]>();
const NO_RESULTS: SearchResult[] = [];
const CACHED_SEARCHES = 20;

function initialQuery(params: URLSearchParams): string {
  const fromUrl = params.get("q");
  if (fromUrl !== null) return fromUrl;
  return Date.now() - lastQuery.leftAt < CACHE_TTL_MS ? lastQuery.text : "";
}

function useAfter(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [on, ms]);
  return on && late;
}

function linkIn(text: string): string | null {
  return routeLink(text) ? text.trim() : null;
}

function playTrack(track: Track, queue: Track[]) {
  playerEngine.primeUserGesture();
  void playerEngine.playTrack(track, queue, "search");
}

export function Search(): JSX.Element {
  useCalmLight();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(() => initialQuery(params));
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [searchSource, setSearchSource] = useState<SearchSource>("all");
  const [sourceMenu, setSourceMenu] = useState<HTMLElement | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const offlineMode = useOfflineMode();
  const online = useStreamingReachable() && !offlineMode;
  const soundCloudOnline = useOnline() && !offlineMode;
  const addHistory = useSearchHistoryStore((state) => state.addItem);
  const like = useLikeTrack();
  const linkPorts = useMemo(() => createLinkPorts(youtubeCatalog), []);
  const [linkText, setLinkText] = useState<string | null>(() => linkIn(query));
  const [linkSlow, setLinkSlow] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [add, setAdd] = useState<{ track: Track; anchor: HTMLElement } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void loadSearchHistory();
  }, []);

  const searchQuery = linkText === null ? query : "";
  const trimmed = searchQuery.trim();

  // the shell's search shortcut sends a fresh state token, so a second press refocuses the field
  const focusToken = (location.state as { focus?: number } | null)?.focus;
  useEffect(() => {
    headRef.current?.querySelector("input")?.focus();
  }, [focusToken]);

  // a link from the shell's share inbox arrives as ?link=1&q=<link>, also while search is already open
  const arrived = params.get("link") === "1" ? params.get("q") : null;
  useEffect(() => {
    if (arrived === null) return;
    setQuery(arrived);
    setLinkText(linkIn(arrived));
    setParams({ q: arrived }, { replace: true });
  }, [arrived, setParams]);

  useEffect(() => {
    if (arrived !== null) return;
    lastQuery.text = query;
    if ((params.get("q") ?? "") === query) return;
    setParams(query ? { q: query } : {}, { replace: true });
  }, [query, params, setParams, arrived]);
  useEffect(
    () => () => {
      lastQuery.leftAt = Date.now();
    },
    [],
  );

  const soundCloudOnly = searchSource === "soundcloud";
  const options = (on: boolean) => ({ enabled: online && !soundCloudOnly && on, limit: LIMIT, debounceMs: DEBOUNCE_MS });
  const all = useSearchAll(searchQuery, options(filter === "all"));
  const songs = useSearchTracks(searchQuery, options(filter === "songs"));
  const albums = useSearchAlbums(searchQuery, options(filter === "albums"));
  const artists = useSearchArtists(searchQuery, options(filter === "artists"));
  const playlists = useSearchPlaylists(searchQuery, options(filter === "playlists"));
  const source = { all, songs, albums, artists, playlists }[filter];
  const soundCloudActive = soundCloudOnline && searchSource !== "youtube" && (filter === "all" || filter === "songs");
  const soundCloud = useSoundCloudSearch(searchQuery, { enabled: soundCloudActive, limit: LIMIT, debounceMs: DEBOUNCE_MS });
  const soundCloudResults = useMemo(() => soundCloud.items.map(soundCloudResult), [soundCloud.items]);
  const youtubeActive = online && !soundCloudOnly;

  const fetched = useMemo((): SearchResult[] => {
    if (filter === "all") return all.items.map(toSearchResult);
    if (filter === "songs") return songs.tracks.map(songResult);
    if (filter === "albums") return albums.albums.map(toSearchResult);
    if (filter === "artists") return artists.artists.map(toSearchResult);
    return playlists.playlists.map(toSearchResult);
  }, [filter, all.items, songs.tracks, albums.albums, artists.artists, playlists.playlists]);

  const cacheKey = `${filter}:${trimmed.toLowerCase()}`;
  const settled = source.hasLoaded && !source.loading;
  useEffect(() => {
    if (!settled || fetched.length === 0) return;
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, fetched);
    // a Map keeps insertion order, so the first key is the oldest search
    if (resultCache.size > CACHED_SEARCHES) resultCache.delete(resultCache.keys().next().value!);
  }, [settled, fetched, cacheKey]);
  const cached = resultCache.get(cacheKey);

  const liked = useLikedTracks();
  const library = usePlaylistsList();
  const local = useMemo(
    () => (online ? [] : localResults(trimmed, liked.data.tracks, library.data.playlists)),
    [online, trimmed, liked.data.tracks, library.data.playlists],
  );

  const files = useLocalTracks(trimmed.length >= 2 ? trimmed : "", LOCAL_SEARCH_LIMIT);
  const fileResults = useMemo(() => files.items.filter((item) => !item.unsupported).map((item) => songResult(toPlayerTrack(item))), [files.items]);
  const shownOnline = settled || !cached ? fetched : cached;
  const results = useMemo(
    () => withLocalFiles(online ? shownOnline : local, fileResults, filter, trimmed),
    [online, shownOnline, local, fileResults, filter, trimmed],
  );
  const streamed = soundCloudOnly ? NO_RESULTS : results;
  const toRank = useMemo(() => songsToRank(streamed, soundCloudResults, filter), [streamed, soundCloudResults, filter]);
  const rankedSongs = useRankedSongs(trimmed, toRank);
  const groups = useMemo(() => groupResults(withSoundCloud(streamed, rankedSongs, filter), filter), [streamed, rankedSongs, filter]);
  const remote = youtubeActive || soundCloudActive;
  const loading = (youtubeActive && source.loading) || (soundCloudActive && soundCloud.loading);
  const allSettled = (!youtubeActive || settled) && (!soundCloudActive || (soundCloud.hasLoaded && !soundCloud.loading));
  const slow = useAfter(remote && loading && trimmed.length >= 2, SLOW_MS) || (linkText !== null && linkSlow);
  const noResults = isEmpty(groups) && (remote ? allSettled && trimmed.length >= 2 : trimmed !== "");
  const pending = remote && loading && isEmpty(groups);
  const hasMore = (key: GroupKey) => online || results.filter((result) => result.kind === GROUP_KIND[key]).length > groups[key].length;

  const activate = (result: SearchResult) => {
    addHistory({
      id: result.id,
      type: result.kind === "song" ? "track" : result.kind,
      title: result.title,
      subtitle: result.subtitle,
      coverUrl: result.cover,
      durationMs: result.durationMs,
      itemData: result.track ?? { href: result.href },
    });
    if (result.track) playTrack(result.track, [result.track]);
    else if (result.href) navigateWithTransition(navigate, result.href);
  };

  const activateHistory = (item: SearchHistoryItem) => {
    if (item.type === "query") {
      setQuery(item.title);
      headRef.current?.querySelector("input")?.focus();
      return;
    }
    if (item.type === "track") {
      if (item.itemData) playTrack(item.itemData as Track, [item.itemData as Track]);
      return;
    }
    const href = (item.itemData as { href?: string } | undefined)?.href ?? legacyHref(item);
    navigateWithTransition(navigate, href);
  };

  const chooseSource = (next: SearchSource) => {
    setSearchSource(next);
    if (next === "soundcloud" && filter !== "all" && filter !== "songs") setFilter("all");
  };

  const sourceLabel = `${t("ui.search.sources")}: ${t(`ui.search.source_${searchSource}`)}`;
  const sourceItems: MenuItem[] = SEARCH_SOURCES.map((id) => ({
    label: t(`ui.search.source_${id}`),
    icon: id === searchSource ? "check" : undefined,
    onSelect: () => chooseSource(id),
  }));

  const changeQuery = (value: string) => {
    setQuery(value);
    if (linkText !== null && value.trim() !== linkText) setLinkText(null);
  };

  // runs on paste and on Enter only, never per keystroke and never from the clipboard by itself
  const openLink = (text: string): boolean => {
    const link = linkIn(text);
    if (link === null) return false;
    setLinkText(link);
    return true;
  };

  const closeShare = () => {
    setShare(null);
    setLinkText(null);
    setQuery("");
  };

  const resultRows = () => [...(resultsRef.current?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])];

  const onFieldKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" && event.target instanceof HTMLInputElement) {
      const first = resultRows()[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.key === "Escape" && linkText !== null) {
      event.preventDefault();
      setLinkText(null);
      setQuery("");
      return;
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && openLink(query)) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement) || trimmed === "") return;
    event.preventDefault();
    addHistory({ id: `query:${trimmed.toLowerCase()}`, type: "query", title: trimmed });
    source.runNow();
    soundCloud.runNow();
  };

  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = resultRows();
    const index = rows.findIndex((row) => row === event.target);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === "ArrowDown") rows[index + 1]?.focus();
    else if (index === 0) headRef.current?.querySelector("input")?.focus();
    else rows[index - 1].focus();
  };

  let body: JSX.Element | null;
  let phase: string;
  if (linkText !== null) {
    phase = "link";
    body = (
      <LinkBlock
        text={linkText}
        ports={linkPorts}
        onPlay={(track) => playTrack(track, [track])}
        onLike={(track) => like.mutate(track)}
        onAddToPlaylist={(track, anchor) => {
          setAdd({ track, anchor });
          setAddOpen(true);
        }}
        onSearch={(text) => {
          setLinkText(null);
          setQuery(text);
        }}
        onShare={setShare}
        onNavigate={(path) => navigateWithTransition(navigate, path)}
        onOpenExternal={openExternal}
        onImport={(_service, url) => useImportsUi.getState().openImport({ initialLink: url })}
        onImportFile={() => useImportsUi.getState().openImport({ mode: "file" })}
        onSlow={setLinkSlow}
      />
    );
  } else if (trimmed === "") {
    phase = "history";
    body = <SearchHistory onActivate={activateHistory} />;
  } else if (noResults) {
    phase = "none";
    body = <p className={styles.line}>{t("ui.search.none", { query: trimmed })}</p>;
  } else if (pending) {
    phase = "pending";
    body = (
      <div className={styles.placeholders} data-placeholder="row">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
          <MediaRowPlaceholder key={index} />
        ))}
      </div>
    );
  } else {
    phase = "results";
    body = <SearchGroups groups={groups} filter={filter} hasMore={hasMore} onShowAll={setFilter} onActivate={activate} />;
  }

  return (
    <div className={styles.page}>
      <Enter index={0} screen="search">
        <div
          className={styles.field}
          ref={headRef}
          onKeyDown={onFieldKeyDown}
          onPaste={(event) => openLink(event.clipboardData.getData("text"))}
          data-tour="search-field"
        >
          <Icon name="search" size={20} />
          <input
            className={styles.input}
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            aria-label={t("ui.search.label")}
            placeholder={t("ui.search.placeholder")}
            spellCheck={false}
            autoComplete="off"
          />
          {query ? (
            <button type="button" className={styles.clear} aria-label={t("ui.clear")} onClick={() => changeQuery("")}>
              <Icon name="clear-circle" size={16} />
            </button>
          ) : null}
          {slow ? (
            <span className={styles.progress} role="progressbar" aria-label={t("ui.search.searching")}>
              <span className={styles.segment} />
            </span>
          ) : null}
        </div>
      </Enter>
      <Enter index={1} screen="search">
        <div className={styles.panel}>
          {online || soundCloudActive ? null : <p className={styles.subline}>{t(offlineMode ? "ui.search.offline_mode" : "ui.search.offline")}</p>}
          {trimmed === "" || linkText !== null ? null : (
            <div className={styles.filters}>
              <div className={styles.tabs} role="tablist" aria-label={t("ui.search.tabs")}>
                {FILTER_PILLS.filter((pill) => !soundCloudOnly || pill.id === "all" || pill.id === "songs").map((pill) => (
                  <button key={pill.id} type="button" role="tab" aria-selected={pill.id === filter} className={styles.tab} onClick={() => setFilter(pill.id)}>
                    <Icon name={pill.icon} size={16} />
                    <span>{t(`ui.search.tab_${pill.id}`)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.tab}
                aria-haspopup="menu"
                aria-expanded={sourceMenu !== null}
                data-chosen={searchSource === "all" ? undefined : ""}
                aria-label={sourceLabel}
                title={sourceLabel}
                onClick={(event) => setSourceMenu(event.currentTarget)}
              >
                <Icon name={SOURCE_ICONS[searchSource]} size={16} />
                <Icon name="chevron-down" size={14} />
              </button>
            </div>
          )}
          <div className={styles.results} ref={resultsRef} onKeyDown={onRowsKeyDown}>
            <div key={`${searchSource}:${filter}:${phase}`} className={styles.swap} data-swap={phase}>
              {body}
            </div>
          </div>
        </div>
      </Enter>
      {share ? (
        <SharePreview
          key={linkText ?? ""}
          share={share}
          ports={linkPorts}
          playlists={library.data.playlists}
          onClose={closeShare}
          onImported={(summary, unreadable) => {
            // the field keeps the link while the page changes: clearing it here would rewrite the URL back to search
            lastQuery.text = "";
            setShare(null);
            if (unreadable > 0) useToastStore.getState().show({ message: t("ui.links.preview.unreadable", { count: unreadable }) });
            const id = summary.targetKind === "liked" ? "likes" : summary.targetId;
            navigateWithTransition(navigate, id ? playlistHref(id) : "/library");
          }}
        />
      ) : null}
      <Menu open={sourceMenu !== null} anchor={sourceMenu} onClose={() => setSourceMenu(null)} items={sourceItems} />
      <Popover open={addOpen} anchor={add?.anchor ?? null} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
        {add ? <AddToPlaylistPopover track={add.track} onDone={() => setAddOpen(false)} /> : null}
      </Popover>
    </div>
  );
}

function legacyHref(item: SearchHistoryItem): string {
  const id = encodeURIComponent(item.id);
  if (item.type === "artist") return `/artist?id=${id}`;
  if (item.type === "album") return `/collection?type=album&id=${id}`;
  return `/collection?type=playlist&id=${id}`;
}
