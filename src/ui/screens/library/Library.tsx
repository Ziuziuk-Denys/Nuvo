import { useDeferredValue, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Enter } from "../../components/Enter";
import { Lens } from "../../components/Lens";
import { Menu, type MenuItem } from "../../components/Menu";
import { Icon } from "../../icons/Icon";
import { useTranslation, type TFunction } from "../../ports/i18n";
import {
  likedTracks,
  notifyLibraryChanged,
  playLibraryEntry,
  useExternalItems,
  useHomePinsStore,
  useLikedTrackCount,
  useRailPinsStore,
  type HomePin,
  type HomePinKind,
  useLikesCover,
  useModalStore,
  usePlaylistsList,
  useYoutubeLibraryItems,
  type LibraryViewMode,
} from "../../ports/library";
import { usePageBackdrop } from "../../ports/backdrop";
import { cancelSaves, exportDocument, saveAsFiles, useDownloadProgress } from "../../ports/exports";
import { usePlayerStore } from "../../ports/player";
import { Swap } from "../../flip";
import { navigateWithTransition } from "../../shell/navigate";
import { useShellScroller } from "../../shell/scroller";
import { shareItemOf, useShareSheet } from "../../sheets/ShareSheet";
import {
  buildEntries,
  entryContext,
  entryKey,
  LIBRARY_TABS,
  sortEntries,
  sortsFor,
  visibleEntries,
  type ContextPlays,
  type LibraryEntry,
  type LibrarySort,
  type LibraryTab,
} from "./libraryModel";
import { LibraryGrid, TilePlaceholders } from "./LibraryGrid";
import { LibraryList } from "./LibraryList";
import { LocalFiles } from "../local/LocalFiles";
import look from "../look.module.css";
import { MediaRowPlaceholder } from "../MediaRow";
import { SearchField } from "../SearchField";
import styles from "./Library.module.css";
import { RecentlyDeletedSheet } from "./RecentlyDeletedSheet";
import { progressByPlaylist } from "../../ports/imports";
import { getImports, useImportSummaries } from "../../ports/importsRuntime";
import { useImportsUi } from "../imports/importsUi";
import { contextPlays } from "../../ports/stats";
import { pinMenuItems } from "../entity/entityActions";

const VIEW_KEY = "nuvo_library_view_mode";
const SORT_KEY = "nuvo_library_sort_v1";
const PLACEHOLDER_ROWS = 6;

function readView(): LibraryViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function readSorts(): Partial<Record<LibraryTab, LibrarySort>> {
  try {
    return JSON.parse(localStorage.getItem(SORT_KEY) ?? "{}") as Partial<Record<LibraryTab, LibrarySort>>;
  } catch {
    return {};
  }
}

function sortOf(sorts: Partial<Record<LibraryTab, LibrarySort>>, tab: LibraryTab): LibrarySort {
  const sort = sorts[tab];
  return sort && sortsFor(tab).includes(sort) ? sort : sortsFor(tab)[0];
}

const NO_PLAYS: ContextPlays = new Map();

function tabFromSearch(search: string): LibraryTab {
  const tab = new URLSearchParams(search).get("tab");
  return LIBRARY_TABS.includes(tab as LibraryTab) ? (tab as LibraryTab) : "all";
}

interface OpenMenu {
  entry: LibraryEntry;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

function useLibraryEntries(t: TFunction) {
  const playlists = usePlaylistsList();
  const { data: albums, loaded: albumsLoaded, error: albumsError } = useExternalItems("album");
  const { data: artists, loaded: artistsLoaded, error: artistsError } = useExternalItems("artist");
  const { data: savedPlaylists, loaded: savedLoaded, error: savedError } = useExternalItems("playlist");
  const youtube = useYoutubeLibraryItems();
  const { data: likedCount } = useLikedTrackCount();
  const summaries = useImportSummaries();
  const importing = useMemo(() => progressByPlaylist(summaries), [summaries]);

  const entries = useMemo(
    () =>
      buildEntries({
        likedCount: likedCount ?? 0,
        playlists: playlists.data.playlists,
        items: [...savedPlaylists, ...albums, ...artists, ...youtube],
        importing,
        t,
      }),
    [likedCount, playlists.data, savedPlaylists, albums, artists, youtube, importing, t],
  );
  // every source first, so a cold visit never flashes "empty" or reshuffles as kinds arrive
  const loading = playlists.isLoading || !albumsLoaded || !artistsLoaded || !savedLoaded;
  const failed = [playlists.error, albumsError, artistsError, savedError].some((error) => error !== undefined);
  return { entries, loading, failed };
}

function cancelImport(playlistId: string): void {
  const { session } = getImports();
  for (const summary of session.getSnapshot()) {
    if (summary.status === "running" && summary.targetId === playlistId) void session.dismiss(summary.id).catch(() => undefined);
  }
}

function menuItems(entry: LibraryEntry, pinned: boolean, t: TFunction, open: () => void): MenuItem[] {
  if (entry.importing !== undefined) return [{ label: t("ui.library.cancel_import"), onSelect: () => cancelImport(entry.id) }];
  const items: MenuItem[] = [
    { label: t("ui.library.open"), onSelect: open },
    { label: t("ui.library.play"), onSelect: () => void playLibraryEntry(entry, entryContext(entry)) },
  ];
  if (entry.kind === "liked") {
    const share = async () => {
      // shortcut: a failed load leaves the menu without a sheet, the Liked page itself shows the error
      const tracks = await likedTracks().catch(() => []);
      if (tracks.length > 0) useShareSheet.getState().show(t("ui.library.liked"), tracks.map(shareItemOf));
    };
    return [...items, { label: t("ui.links.share.title"), disabled: entry.count === 0, onSelect: () => void share() }];
  }
  // pinned comes from selectors; the handlers read the stores when chosen, so nothing goes stale
  const pin = {
    kind: entry.kind as HomePinKind,
    id: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    imageUrl: entry.cover ?? undefined,
    href: entry.href,
    trackCount: entry.count,
  };
  items.push(...pinMenuItems(pin, pinned, t));
  if (entry.external) return items;
  const remove = () =>
    useModalStore.getState().openRemoveFromLibrary({
      id: entry.id,
      title: entry.title,
      coverUrl: entry.cover ?? "",
      type: entry.kind as "playlist",
      subtitle: entry.subtitle,
      isOwned: entry.own === true,
    });
  items.push("separator", { label: t(entry.own ? "ui.library.delete_playlist" : "ui.library.remove"), danger: true, onSelect: remove });
  return items;
}

export function Library(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [tab, setTab] = useState<LibraryTab>(() => tabFromSearch(search));
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LibraryViewMode>(readView);
  const [sorts, setSorts] = useState(readSorts);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [plays, setPlays] = useState<ContextPlays>(NO_PLAYS);
  // the last menu stays set while it fades out; menuOpen says whether it is up
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // the More menu's anchor stays set while it fades out; moreOpen says whether it is up
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const saving = useDownloadProgress();
  const deferredQuery = useDeferredValue(query);
  const filterRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scroller = useShellScroller();

  const { entries, loading, failed } = useLibraryEntries(t);
  const contentKey = `${tab}:${view}:${loading}`;
  usePageBackdrop(useLikesCover(), { blur: 56, dim: 0.22 });
  const sort = sortOf(sorts, tab);
  const byPlays = sort === "played" || sort === "plays";
  useEffect(() => {
    if (byPlays) void contextPlays().then(setPlays);
  }, [byPlays]);
  const shown = useMemo(() => sortEntries(visibleEntries(entries, tab, deferredQuery), sort, plays), [entries, tab, deferredQuery, sort, plays]);
  const playbackContext = usePlayerStore((state) => state.playbackContext);
  const playing = useMemo(() => {
    const found = playbackContext ? entries.find((entry) => entryContext(entry) === playbackContext) : undefined;
    return found ? entryKey(found) : null;
  }, [entries, playbackContext]);
  const pinnedHere = (pins: HomePin[]) => (menu ? pins.some((pin) => pin.kind === menu.entry.kind && pin.id === menu.entry.id) : false);
  const pinnedOnHome = useHomePinsStore((state) => pinnedHere(state.pins));
  const pinnedOnBar = useRailPinsStore((state) => pinnedHere(state.pins));
  const menuPinned = pinnedOnHome || pinnedOnBar;

  const changeView = (next: LibraryViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // private storage: the choice lasts for this session only
    }
  };

  const changeSort = (next: LibrarySort) => {
    const all = { ...sorts, [tab]: next };
    setSorts(all);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(all));
    } catch {
      // private storage: the order lasts for this session only
    }
  };

  const activate = (entry: LibraryEntry) => {
    if (entry.importing !== undefined) return;
    navigateWithTransition(navigate, entry.href);
  };

  const tabs = LIBRARY_TABS.map((id) => ({ id, label: t(`ui.library.tab_${id}`) }));
  const libraryEmpty = entries.length <= 1 && (entries[0]?.count ?? 0) === 0;
  const filtering = deferredQuery.trim() !== "";
  const clearFilter = () => {
    setQuery("");
    filterRef.current?.querySelector("input")?.focus();
  };
  const viewProps = {
    entries: shown,
    selected: menu && menuOpen ? entryKey(menu.entry) : null,
    playing,
    onActivate: activate,
    onMenu: (entry: LibraryEntry, anchor: HTMLElement | null, at?: { x: number; y: number }) => {
      setMenu({ entry, anchor, at });
      setMenuOpen(true);
    },
    t,
  };

  let content: JSX.Element;
  if (tab === "local") {
    content = <LocalFiles query={deferredQuery} sort={sort} />;
  } else if (loading) {
    content =
      view === "grid" ? (
        <TilePlaceholders />
      ) : (
        <div className={styles.placeholders} data-placeholder="row">
          {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
            <MediaRowPlaceholder key={index} />
          ))}
        </div>
      );
  } else if (libraryEmpty && failed) {
    content = (
      <EmptyState
        title={t("ui.library.load_error_title")}
        message={t("ui.library.load_error_message")}
        actions={[{ label: t("ui.library.retry"), primary: true, onClick: notifyLibraryChanged }]}
      />
    );
  } else if (libraryEmpty && !filtering) {
    content = (
      <EmptyState
        title={t("ui.library.empty_title")}
        message={t("ui.library.empty_message")}
        tour="library-import"
        actions={[
          { label: t("ui.library.create_playlist"), primary: true, onClick: () => useModalStore.getState().openCreatePlaylist() },
          { label: t("ui.library.import"), onClick: () => useImportsUi.getState().openImport() },
        ]}
      />
    );
  } else if (shown.length === 0 && filtering) {
    content = (
      <div className={styles.inline}>
        <p className={styles.line}>{t("ui.library.no_match", { query: deferredQuery.trim() })}</p>
        <Button variant="text" onClick={clearFilter}>
          {t("ui.library.clear_filter")}
        </Button>
      </div>
    );
  } else if (shown.length === 0) {
    content = <p className={styles.line}>{t(`ui.library.empty_${tab}`)}</p>;
  } else {
    content = view === "grid" ? <LibraryGrid {...viewProps} /> : <LibraryList {...viewProps} />;
  }

  return (
    <div className={styles.page} data-view={view}>
      <Enter index={0} screen="library">
        <h1 className={look.pageTitle}>{t("ui.library.title")}</h1>
        <div className={styles.bar}>
          <div className={styles.tabs} role="tablist" aria-label={t("ui.library.tabs")} data-tour="library-tabs">
            {tabs.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={item.id === tab} className={look.tab} onClick={() => setTab(item.id)}>
                {item.id === tab ? <Lens group="library-tab" value={tab} radius={16} className={styles.tabLens} /> : null}
                {item.label}
              </button>
            ))}
          </div>
          <div className={styles.tools}>
            <div ref={filterRef} className={styles.filter}>
              <SearchField value={query} onChange={setQuery} placeholder={t(`library.search_${tab}`)} clearLabel={t("ui.clear")} />
            </div>
            {tab !== "local" ? (
              <div className={styles.views}>
                <button
                  type="button"
                  className={look.icon}
                  aria-label={t("ui.library.view_grid")}
                  aria-pressed={view === "grid"}
                  onClick={() => changeView("grid")}
                >
                  {view === "grid" ? <Lens group="library-view" value={view} radius={16} /> : null}
                  <Icon name="grid" size={16} />
                </button>
                <button
                  type="button"
                  className={look.icon}
                  aria-label={t("ui.library.view_list")}
                  aria-pressed={view === "list"}
                  onClick={() => changeView("list")}
                >
                  {view === "list" ? <Lens group="library-view" value={view} radius={16} /> : null}
                  <Icon name="list" size={16} />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={look.icon}
              aria-label={t("ui.library.sort.label", { order: t(`ui.library.sort.${sort}`) })}
              title={t("ui.library.sort.label", { order: t(`ui.library.sort.${sort}`) })}
              aria-haspopup="menu"
              aria-expanded={sortAnchor !== null}
              onClick={(event) => setSortAnchor(sortAnchor ? null : event.currentTarget)}
            >
              <Icon name="sort-lines" size={18} />
            </button>
            <button
              type="button"
              className={look.icon}
              aria-label={t("ui.export.more")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(event) => {
                setMoreAnchor(event.currentTarget);
                setMoreOpen(true);
              }}
            >
              <Icon name="more" size={18} />
            </button>
            {tab === "all" || tab === "playlists" ? (
              <button
                type="button"
                className={`${look.pill} ${look.solid} ${styles.create}`}
                aria-label={t("ui.library.create_playlist")}
                title={t("ui.library.create_playlist")}
                data-tour="new-playlist"
                onClick={() => useModalStore.getState().openCreatePlaylist()}
              >
                <Icon name="add" size={16} />
                <span className={styles.createLabel}>{t("ui.library.create_playlist")}</span>
              </button>
            ) : null}
          </div>
        </div>
      </Enter>
      <Enter index={1} screen="library">
        {failed && !libraryEmpty && !loading ? (
          <div className={`${styles.inline} ${styles.notice}`}>
            <p className={styles.line}>{t("ui.library.load_error_line")}</p>
            <Button variant="text" onClick={notifyLibraryChanged}>
              {t("ui.library.retry")}
            </Button>
          </div>
        ) : null}
        <div className={styles.stage}>
          <Swap view={contentKey} target={contentRef} scroller={scroller}>
            <div ref={contentRef} className={styles.content} key={contentKey}>
              {content}
            </div>
          </Swap>
        </div>
      </Enter>

      <Menu
        open={moreOpen}
        anchor={moreAnchor}
        onClose={() => setMoreOpen(false)}
        items={[
          { label: t("ui.history.title"), onSelect: () => navigateWithTransition(navigate, "/stats/history") },
          { label: t("ui.library.recently_deleted"), onSelect: () => setTrashOpen(true) },
          "separator",
          {
            label: t("ui.export.save_files"),
            onSelect: () => void saveAsFiles({ liked: true, label: t("ui.library.liked"), playlistFile: true }),
          },
          { label: t("ui.export.library_json"), onSelect: () => void exportDocument({ kind: "library", format: "json" }) },
          { label: t("ui.export.library_csv"), onSelect: () => void exportDocument({ kind: "library", format: "csv" }) },
          ...(saving && saving.total > 0 ? [{ label: t("ui.export.cancel"), onSelect: () => void cancelSaves() }] : []),
        ]}
      />
      <RecentlyDeletedSheet open={trashOpen} onClose={() => setTrashOpen(false)} />
      <Menu
        open={sortAnchor !== null}
        anchor={sortAnchor}
        onClose={() => setSortAnchor(null)}
        items={sortsFor(tab).map((key) => ({ label: t(`ui.library.sort.${key}`), onSelect: () => changeSort(key) }))}
      />
      <Menu
        open={menuOpen}
        anchor={menu?.anchor ?? null}
        at={menu?.at}
        onClose={() => setMenuOpen(false)}
        items={menu ? menuItems(menu.entry, menuPinned, t, () => activate(menu.entry)) : []}
      />
    </div>
  );
}
