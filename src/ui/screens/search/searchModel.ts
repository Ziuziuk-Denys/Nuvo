import { playlistHref } from "../../app/hrefs";
import { filterTracks, normalizeForSearch, songResult, type SearchHistoryItem, type SearchKind, type SearchResult } from "../../ports/search";
import type { TFunction } from "../../ports/i18n";
import type { Track } from "../../ports/player";

export type SearchFilter = "all" | "songs" | "albums" | "artists" | "playlists";

export const SEARCH_FILTERS: SearchFilter[] = ["all", "songs", "albums", "artists", "playlists"];

export type SearchSource = "all" | "youtube" | "soundcloud";

export const SEARCH_SOURCES: SearchSource[] = ["all", "youtube", "soundcloud"];

export type GroupKey = Exclude<SearchFilter, "all">;

export const GROUP_KIND: Record<GroupKey, SearchKind> = {
  songs: "song",
  albums: "album",
  artists: "artist",
  playlists: "playlist",
};

export const ALL_CAPS: Record<GroupKey, number> = { songs: 6, albums: 4, artists: 4, playlists: 4 };

export interface SearchGroups {
  top?: SearchResult;
  songs: SearchResult[];
  albums: SearchResult[];
  artists: SearchResult[];
  playlists: SearchResult[];
}

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

export function songsToRank(results: readonly SearchResult[], found: readonly SearchResult[], filter: SearchFilter): SearchResult[] {
  return filter === "all" || filter === "songs" ? [...results.filter((result) => result.kind === "song"), ...found] : [];
}

/** Puts the ranked songs from every source where the first song was. */
export function withSoundCloud(results: readonly SearchResult[], songs: readonly SearchResult[], filter: SearchFilter): SearchResult[] {
  if (filter !== "all" && filter !== "songs") return [...results];
  const firstSong = results.findIndex((result) => result.kind === "song");
  const at = firstSong === -1 ? results.length : firstSong;
  const others = results.filter((result) => result.kind !== "song");
  const before = others.filter((result) => results.indexOf(result) < at);
  return [...before, ...songs, ...others.slice(before.length)];
}

export const LOCAL_SEARCH_LIMIT = 6;

function songKey(result: SearchResult): string {
  const title = normalizeForSearch(result.title.replace(/[([][^)\]]*[)\]]/g, " "))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const artist = normalizeForSearch(result.subtitle.split(",")[0] ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return `${title}|${artist}`;
}

function matchRank(result: SearchResult, query: string): number {
  const title = normalizeForSearch(result.title);
  const wanted = normalizeForSearch(query);
  if (!wanted) return 2;
  if (title === wanted) return 0;
  return title.startsWith(wanted) ? 1 : 2;
}

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

export function historyHref(item: SearchHistoryItem): string {
  const saved = (item.itemData as { href?: string } | undefined)?.href;
  if (saved) return saved;
  const id = encodeURIComponent(item.id);
  if (item.type === "artist") return `/artist?id=${id}`;
  if (item.type === "album") return `/collection?type=album&id=${id}`;
  return `/collection?type=playlist&id=${id}`;
}

export function subtitleOf(result: SearchResult, t: TFunction): string {
  if (result.kind === "song") return t("ui.search.kind_song", { artist: result.subtitle });
  if (result.kind === "album") return result.subtitle ? t("ui.library.kind_album", { artist: result.subtitle }) : t("ui.library.kind_album_plain");
  if (result.kind === "artist") return t("ui.library.kind_artist");
  return result.subtitle ? t("ui.library.kind_playlist", { owner: result.subtitle }) : t("ui.library.kind_playlist_plain");
}
