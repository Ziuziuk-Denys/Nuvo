import type { Track } from "@/engine/types";
import { CORE_BASE_URL } from "@/data/core/request";
import { toUiTrack } from "@/data/catalog/tracks";
import type { CatalogSearchItem } from "@/data/search/catalogSearch";
import { createSearchHistory } from "@/data/search/history";

export { filterTracks, normalizeForSearch, type SearchableTrack, type TrackMatch } from "@/data/search/trackMatch";
export { useSearchAll, useSearchTracks, useSearchAlbums, useSearchArtists, useSearchPlaylists } from "@/data/search/catalogSearch";
export type { SearchHistoryItem } from "@/data/search/history";

export const { useSearchHistoryStore, loadSearchHistory } = createSearchHistory({
  base: CORE_BASE_URL,
  fetch: (input, init) => fetch(input, init),
  storage: () => localStorage,
});

export type SearchKind = "song" | "album" | "artist" | "playlist";

/** One search hit, shaped for a row: a song carries its playable track, the rest an href. */
export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  cover: string;
  durationMs?: number;
  track?: Track;
  href?: string;
}

export function songResult(track: Track): SearchResult {
  return { kind: "song", id: track.id, title: track.title, subtitle: track.artists, cover: track.coverUrl, durationMs: track.durationMs, track };
}

/** The catalog's search items as rows, with their covers and links. */
export function toSearchResult(item: CatalogSearchItem): SearchResult {
  const cover = item.cover?.url ?? "";
  if (item.kind === "track") return songResult(toUiTrack(item));
  if (item.kind === "artist") {
    return { kind: "artist", id: item.id, title: item.name, subtitle: "", cover, href: `/artist?id=${encodeURIComponent(item.id)}` };
  }
  if (item.kind === "album") {
    return {
      kind: "album",
      id: item.id,
      title: item.title,
      subtitle: item.artists.map((artist) => artist.name).join(", "),
      cover,
      href: `/collection?type=album&id=${encodeURIComponent(item.id)}`,
    };
  }
  return {
    kind: "playlist",
    id: item.id,
    title: item.title,
    subtitle: item.author ?? "",
    cover,
    href: `/collection?type=playlist&id=${encodeURIComponent(item.id)}`,
  };
}
