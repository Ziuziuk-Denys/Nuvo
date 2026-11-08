import { playlistHref } from "../../app/hrefs";
import { filterTracks, normalizeForSearch, songResult, type SearchKind, type SearchResult } from "../../ports/search";
import type { Track } from "../../ports/player";

export type SearchFilter = "all" | "songs" | "albums" | "artists" | "playlists";

export const SEARCH_FILTERS: SearchFilter[] = ["all", "songs", "albums", "artists", "playlists"];

export type GroupKey = Exclude<SearchFilter, "all">;

export const GROUP_KIND: Record<GroupKey, SearchKind> = {
  songs: "song",
  albums: "album",
  artists: "artist",
  playlists: "playlist",
};

/** How many rows each group shows under All; a filter tab shows its whole group. */
export const ALL_CAPS: Record<GroupKey, number> = { songs: 6, albums: 4, artists: 4, playlists: 4 };

export interface SearchGroups {
  top?: SearchResult;
  songs: SearchResult[];
  albums: SearchResult[];
  artists: SearchResult[];
  playlists: SearchResult[];
}

/**
 * All: the first hit is the top result and the rest fill capped groups, the top result left out of
 * its own group. A filter: that group only, uncapped.
 */
export function groupResults(all: readonly SearchResult[], filter: SearchFilter): SearchGroups {
  const groups: SearchGroups = { songs: [], albums: [], artists: [], playlists: [] };
  const top = filter === "all" ? all[0] : undefined;
  if (top) groups.top = top;
  const keys = filter === "all" ? (Object.keys(GROUP_KIND) as GroupKey[]) : [filter];
  for (const key of keys) {
    const items = all.filter((result) => result.kind === GROUP_KIND[key] && result !== top);
    groups[key] = filter === "all" ? items.slice(0, ALL_CAPS[key]) : items;
  }
  return groups;
}

export const LOCAL_SEARCH_LIMIT = 6;

/** The same song streamed and as a file: folded title without a bracketed tag, and the first artist. */
function songKey(result: SearchResult): string {
  const title = normalizeForSearch(result.title.replace(/[([][^)\]]*[)\]]/g, " "))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const artist = normalizeForSearch(result.subtitle.split(",")[0] ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return `${title}|${artist}`;
}

/** 0 for the exact title, 1 for a title that starts with the query, 2 for the rest. */
function matchRank(result: SearchResult, query: string): number {
  const title = normalizeForSearch(result.title);
  const wanted = normalizeForSearch(query);
  if (!wanted) return 2;
  if (title === wanted) return 0;
  return title.startsWith(wanted) ? 1 : 2;
}

/**
 * Files on this computer join the songs once each: a streamed copy of a song the user has as a file
 * is dropped, and the songs are ordered by how well the title matches, a file first only on a tie.
 * A leading artist, album or playlist stays where it was.
 */
export function withLocalFiles(results: readonly SearchResult[], files: readonly SearchResult[], filter: SearchFilter, query = ""): SearchResult[] {
  if (files.length === 0 || (filter !== "all" && filter !== "songs")) return [...results];
  const ids = new Set(files.map((file) => file.id));
  const keys = new Set(files.map(songKey));
  const streamed = results.filter((result) => result.kind === "song" && !ids.has(result.id) && !keys.has(songKey(result)));
  const songs = [...files, ...streamed].map((result, order) => ({ result, order, rank: matchRank(result, query) }));
  songs.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const others = results.filter((result) => result.kind !== "song");
  const firstSong = results.findIndex((result) => result.kind === "song");
  const before = firstSong === -1 ? others : results.slice(0, firstSong).filter((result) => result.kind !== "song");
  return [...before, ...songs.map((song) => song.result), ...others.slice(before.length)];
}

export function isEmpty(groups: SearchGroups): boolean {
  return !groups.top && groups.songs.length + groups.albums.length + groups.artists.length + groups.playlists.length === 0;
}

export interface LocalPlaylist {
  id: string;
  title: string;
  trackCount: number;
  coverUrl: string;
}

/** Offline search: liked songs by title, artist or album, and your playlists by name, with the same folding. */
export function localResults(query: string, liked: readonly Track[], playlists: readonly LocalPlaylist[]): SearchResult[] {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const songs = filterTracks(liked, query).map(({ track }) => songResult(track));
  const lists = playlists
    .filter((playlist) => {
      const title = normalizeForSearch(playlist.title);
      return words.every((word) => title.includes(word));
    })
    .map((playlist): SearchResult => ({
      kind: "playlist",
      id: playlist.id,
      title: playlist.title,
      subtitle: "",
      cover: playlist.coverUrl,
      href: playlistHref(playlist.id),
    }));
  return [...songs, ...lists];
}
