import { playlistHref } from "../../app/hrefs";
import type { LibraryItemViewModel, LibraryPlaylistSummary } from "../../ports/library";

export type LibraryTab = "all" | "playlists" | "albums" | "artists" | "local";
export const LIBRARY_TABS: LibraryTab[] = ["all", "playlists", "albums", "artists", "local"];

export interface LibraryEntry {
  kind: "liked" | "playlist" | "album" | "artist";
  id: string;
  title: string;
  subtitle: string;
  cover: string | null;
  count?: number;
  /** Percent done for a playlist that is still importing. */
  importing?: number;
  href: string;
  /** ISO time it was added or last changed: the library lists newest first. */
  addedAt: string;
  /** One of your own playlists: it can be deleted, not just removed. */
  own?: boolean;
  /** Mirrored from an account (YouTube Music): it cannot be removed here. */
  external?: boolean;
  /** Who made it, for the sort by artist: the album's artist, the playlist's owner, the artist itself. */
  creator?: string;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface BuildInput {
  likedCount: number;
  playlists: LibraryPlaylistSummary[];
  /** Saved albums, artists and playlists, including the ones mirrored from an account. */
  items: LibraryItemViewModel[];
  /** Running imports by target playlist id (done and total songs). */
  importing?: ReadonlyMap<string, { done: number; total: number }>;
  t: Translate;
}

function importPercent(progress: { done: number; total: number } | undefined): number | undefined {
  if (!progress) return undefined;
  return progress.total > 0 ? Math.min(100, Math.floor((progress.done * 100) / progress.total)) : 0;
}

export function buildEntries({ likedCount, playlists, items, importing, t }: BuildInput): LibraryEntry[] {
  const you = t("ui.library.you");
  const entries: LibraryEntry[] = [
    {
      kind: "liked",
      id: "likes",
      title: t("ui.library.liked"),
      subtitle: t("ui.library.kind_playlist", { owner: you }),
      cover: null,
      count: likedCount,
      href: "/library/playlist?id=likes",
      addedAt: "",
    },
  ];

  for (const playlist of playlists) {
    entries.push({
      kind: "playlist",
      id: playlist.id,
      title: playlist.title,
      subtitle: t("ui.library.kind_playlist", { owner: you }),
      cover: playlist.coverUrl || playlist.coverUrls[0] || null,
      count: playlist.trackCount,
      importing: importPercent(importing?.get(playlist.id)),
      href: playlistHref(playlist.id),
      addedAt: playlist.updatedAt || playlist.createdAt,
      own: true,
      creator: you,
    });
  }

  for (const item of items) {
    const creator = item.creator ?? "";
    const subtitle =
      item.kind === "artist"
        ? t("ui.library.kind_artist")
        : item.kind === "album"
          ? creator
            ? t("ui.library.kind_album", { artist: creator })
            : t("ui.library.kind_album_plain")
          : creator
            ? t("ui.library.kind_playlist", { owner: creator })
            : t("ui.library.kind_playlist_plain");
    entries.push({
      kind: item.kind,
      id: item.id,
      title: item.title,
      subtitle,
      cover: item.imageUrl || null,
      count: item.trackCount,
      href: item.href,
      addedAt: item.addedAt,
      external: item.source !== undefined,
      creator: item.kind === "artist" ? item.title : creator,
    });
  }
  return entries;
}

/** Lower case without diacritics, with ё read as е, so "ёлка" finds "Елка" and "cafe" finds "Café". */
export function foldForFilter(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

const TAB_KINDS: Record<LibraryTab, LibraryEntry["kind"][]> = {
  all: ["liked", "playlist", "album", "artist"],
  playlists: ["liked", "playlist"],
  albums: ["album"],
  artists: ["artist"],
  // files on this computer have their own view, not library entries
  local: [],
};

const newestFirst = (a: LibraryEntry, b: LibraryEntry) => (b.addedAt > a.addedAt ? 1 : b.addedAt < a.addedAt ? -1 : 0);

/** The entries one tab shows for a filter, newest first. Liked songs leads whenever the tab shows it. */
export function visibleEntries(entries: LibraryEntry[], tab: LibraryTab, query: string): LibraryEntry[] {
  const kinds = TAB_KINDS[tab];
  const needle = foldForFilter(query.trim());
  const shown = entries.filter((entry) => kinds.includes(entry.kind) && (!needle || foldForFilter(`${entry.title} ${entry.subtitle}`).includes(needle)));
  const liked = shown.filter((entry) => entry.kind === "liked");
  const rest = shown.filter((entry) => entry.kind !== "liked").sort(newestFirst);
  return [...liked, ...rest];
}

export type LibrarySort = "added" | "title" | "artist" | "played" | "plays" | "album";
/** The orders each view offers, its default first; files on this computer come in artist order from the scan. */
export const ENTRY_SORTS: LibrarySort[] = ["added", "title", "artist", "played", "plays"];
export const LOCAL_SORTS: LibrarySort[] = ["artist", "title", "album", "plays"];

export const sortsFor = (tab: LibraryTab): LibrarySort[] => (tab === "local" ? LOCAL_SORTS : ENTRY_SORTS);

/** Plays started from an entry's page and the last one, by its playback context. */
export type ContextPlays = ReadonlyMap<string, { plays: number; lastPlayedAt: string }>;

const byText = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

/** The entries in another order; ties and never played entries keep the newest first order they came in. Liked songs stays first. */
export function sortEntries(entries: LibraryEntry[], sort: LibrarySort, plays: ContextPlays): LibraryEntry[] {
  if (sort === "added" || sort === "album") return entries;
  const stat = (entry: LibraryEntry) => plays.get(entryContext(entry));
  const compare: Record<"title" | "artist" | "played" | "plays", (a: LibraryEntry, b: LibraryEntry) => number> = {
    title: (a, b) => byText(a.title, b.title),
    artist: (a, b) => byText(a.creator || a.title, b.creator || b.title),
    played: (a, b) => (stat(b)?.lastPlayedAt ?? "").localeCompare(stat(a)?.lastPlayedAt ?? ""),
    plays: (a, b) => (stat(b)?.plays ?? 0) - (stat(a)?.plays ?? 0),
  };
  const liked = entries.filter((entry) => entry.kind === "liked");
  return [...liked, ...entries.filter((entry) => entry.kind !== "liked").sort(compare[sort])];
}

/** Files on this computer in another order; "artist" is the order the scan keeps. */
export function sortLocal<T extends { title: string; artists: string; album?: { title: string }; playCount?: number }>(tracks: T[], sort: LibrarySort): T[] {
  if (sort === "title") return [...tracks].sort((a, b) => byText(a.title, b.title));
  if (sort === "album") return [...tracks].sort((a, b) => byText(a.album?.title ?? "", b.album?.title ?? ""));
  if (sort === "plays") return [...tracks].sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
  return tracks;
}

/** The playback context the entry's own page sets, so the playing entry can be found and marked. */
export function entryContext(entry: LibraryEntry): string {
  if (entry.kind === "liked") return "playlist:likes";
  return `${entry.kind}:${entry.id}`;
}

export function entryKey(entry: LibraryEntry): string {
  return `${entry.kind}:${entry.id}`;
}
