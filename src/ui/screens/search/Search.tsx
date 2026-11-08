import { playlistHref } from "../../app/hrefs";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Enter } from "../../components/Enter";
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
import { useOfflineMode, useStreamingReachable } from "../../ports/network";
import { playerEngine, type Track } from "../../ports/player";
import {
  loadSearchHistory,
  songResult,
  toSearchResult,
  useSearchAlbums,
  useSearchAll,
  useSearchArtists,
  useSearchHistoryStore,
  useSearchPlaylists,
  useSearchTracks,
  type SearchHistoryItem,
  type SearchResult,
} from "../../ports/search";
import { navigateWithTransition } from "../../shell/navigate";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { useImportsUi } from "../imports/importsUi";
import { MediaRowPlaceholder } from "../MediaRow";
import { LinkBlock } from "./LinkBlock";
import { SharePreview } from "./SharePreview";
import { GROUP_KIND, groupResults, isEmpty, LOCAL_SEARCH_LIMIT, localResults, withLocalFiles, type GroupKey, type SearchFilter } from "./searchModel";
import { SearchGroups } from "./SearchGroups";
import { SearchHistory } from "./SearchHistory";
import styles from "./Search.module.css";

/** The legacy popup's numbers: a query survives a minute away from search, requests wait 320 ms. */
const CACHE_TTL_MS = 60_000;
const DEBOUNCE_MS = 320;
const LIMIT = 20;
const SLOW_MS = 300;
const PLACEHOLDER_ROWS = 5;

/** The filter pills in the order and with the glyphs the field has always shown. */
const FILTER_PILLS: { id: SearchFilter; icon: IconName }[] = [
  { id: "all", icon: "grid" },
  { id: "songs", icon: "track" },
  { id: "artists", icon: "artist" },
  { id: "albums", icon: "album" },
  { id: "playlists", icon: "playlist" },
];

const lastQuery = { text: "", leftAt: 0 };
/** Recent results by filter and query, so a return to search paints at once while the hook asks again. */
const resultCache = new Map<string, SearchResult[]>();
const CACHED_SEARCHES = 20;

function initialQuery(params: URLSearchParams): string {
  const fromUrl = params.get("q");
  if (fromUrl !== null) return fromUrl;
  return Date.now() - lastQuery.leftAt < CACHE_TTL_MS ? lastQuery.text : "";
}

/** True once `on` has held for `ms`; false again as soon as it drops. */
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

/** The pasted link a text stands for, or null for a normal query. */
function linkIn(text: string): string | null {
  return routeLink(text) ? text.trim() : null;
}

/** Plays a search hit alone; radio follows through autoplay similar. */
function playTrack(track: Track, queue: Track[]) {
  playerEngine.primeUserGesture();
  void playerEngine.playTrack(track, queue, "search");
}

/** /search: one field, filter tabs and grouped rows, recent searches when empty, the library when offline. */
export function Search(): JSX.Element {
  useCalmLight();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(() => initialQuery(params));
  const [filter, setFilter] = useState<SearchFilter>("all");
  const headRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // offline mode asks nothing of the network: search falls back to the library and files, as with no connection
  const offlineMode = useOfflineMode();
  const online = useStreamingReachable() && !offlineMode;
  const addHistory = useSearchHistoryStore((state) => state.addItem);
  const like = useLikeTrack();
  const linkPorts = useMemo(() => createLinkPorts(youtubeCatalog), []);
  // a link in the field on arrival (a shared link, or a return within the minute) opens its block again
  const [linkText, setLinkText] = useState<string | null>(() => linkIn(query));
  const [linkSlow, setLinkSlow] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [add, setAdd] = useState<{ track: Track; anchor: HTMLElement } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // recent searches live in the daemon: ask for them on arrival (the first time this also moves the old local list)
  useEffect(() => {
    void loadSearchHistory();
  }, []);

  // while a link shows its block the search hooks get "": nothing is searched and nothing reaches the history
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

  // the URL keeps ?q= in step with the field, replacing the entry instead of adding one per keystroke
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

  const options = (on: boolean) => ({ enabled: online && on, limit: LIMIT, debounceMs: DEBOUNCE_MS });
  const all = useSearchAll(searchQuery, options(filter === "all"));
  const songs = useSearchTracks(searchQuery, options(filter === "songs"));
  const albums = useSearchAlbums(searchQuery, options(filter === "albums"));
  const artists = useSearchArtists(searchQuery, options(filter === "artists"));
  const playlists = useSearchPlaylists(searchQuery, options(filter === "playlists"));
  const source = { all, songs, albums, artists, playlists }[filter];

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
  const groups = useMemo(() => groupResults(results, filter), [results, filter]);
  const slow = useAfter(online && source.loading && trimmed.length >= 2, SLOW_MS) || (linkText !== null && linkSlow);
  const noResults = isEmpty(groups) && (online ? settled && trimmed.length >= 2 : trimmed !== "");
  // a query in flight with nothing to show yet draws rows of the results' shape instead of a blank panel
  const pending = online && source.loading && isEmpty(groups);
  // under All a group's tab holds more when the catalog is asked again; offline only when rows were cut
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

  // the preview stands for the pasted link: closing it empties the field
  const closeShare = () => {
    setShare(null);
    setLinkText(null);
    setQuery("");
  };

  const resultRows = () => [...(resultsRef.current?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])];

  // roving focus: Down from the field enters the rows, Up from the first row returns to the field
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
  };

  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = resultRows();
    const index = rows.findIndex((row) => row === event.target);
    // only a row itself moves focus: the like and menu buttons inside it, and popovers, keep their keys
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
          {online ? null : <p className={styles.subline}>{t(offlineMode ? "ui.search.offline_mode" : "ui.search.offline")}</p>}
          {trimmed === "" || linkText !== null ? null : (
            <div className={styles.tabs} role="tablist" aria-label={t("ui.search.tabs")}>
              {FILTER_PILLS.map((pill) => (
                <button key={pill.id} type="button" role="tab" aria-selected={pill.id === filter} className={styles.tab} onClick={() => setFilter(pill.id)}>
                  <Icon name={pill.icon} size={16} />
                  <span>{t(`ui.search.tab_${pill.id}`)}</span>
                </button>
              ))}
            </div>
          )}
          {/* links plan: the link block takes this place, in place of the tabs and groups, while a link is shown */}
          <div className={styles.results} ref={resultsRef} onKeyDown={onRowsKeyDown}>
            {/* a new tab or a new kind of content fades in; new rows for the same tab replace the old in place */}
            <div key={`${filter}:${phase}`} className={styles.swap} data-swap={phase}>
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
      <Popover open={addOpen} anchor={add?.anchor ?? null} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
        {add ? <AddToPlaylistPopover track={add.track} onDone={() => setAddOpen(false)} /> : null}
      </Popover>
    </div>
  );
}

/** History rows filed by the legacy popup carry no href. */
function legacyHref(item: SearchHistoryItem): string {
  const id = encodeURIComponent(item.id);
  if (item.type === "artist") return `/artist?id=${id}`;
  if (item.type === "album") return `/collection?type=album&id=${id}`;
  return `/collection?type=playlist&id=${id}`;
}
