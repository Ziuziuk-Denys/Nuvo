import { useEffect, useMemo, useState } from "react";
import type { Track } from "@/engine/types";
import { CORE_BASE_URL } from "@/data/core/request";
import { toUiTrack } from "@/data/catalog/tracks";
import type { CatalogSearchItem } from "@/data/search/catalogSearch";
import type { SoundCloudHit } from "@/data/search/soundcloudSearch";
import { createSearchHistory } from "@/data/search/history";
import { rankSongIds } from "@/data/search/rankSongs";

export { filterTracks, normalizeForSearch, type SearchableTrack, type TrackMatch } from "@/data/search/trackMatch";
export { useSearchAll, useSearchTracks, useSearchAlbums, useSearchArtists, useSearchPlaylists } from "@/data/search/catalogSearch";
export { useSoundCloudSearch } from "@/data/search/soundcloudSearch";
export type { SearchHistoryItem } from "@/data/search/history";

export const { useSearchHistoryStore, loadSearchHistory } = createSearchHistory({
  base: CORE_BASE_URL,
  fetch: (input, init) => fetch(input, init),
  storage: () => localStorage,
});

export type SearchKind = "song" | "album" | "artist" | "playlist";

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  cover: string;
  durationMs?: number;
  track?: Track;
  href?: string;
  preview?: boolean;
  plays?: number;
  verified?: boolean;
}

export function songResult(track: Track): SearchResult {
  return { kind: "song", id: track.id, title: track.title, subtitle: track.artists, cover: track.coverUrl, durationMs: track.durationMs, track };
}

export function soundCloudResult(hit: SoundCloudHit): SearchResult {
  return {
    ...songResult(hit.track),
    ...(hit.preview ? { preview: true } : {}),
    ...(hit.plays !== undefined ? { plays: hit.plays } : {}),
    ...(hit.verified ? { verified: true } : {}),
  };
}

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

// Until the daemon answers, the last order holds for songs it knew and new songs follow in the given order
export function useRankedSongs(query: string, songs: readonly SearchResult[]): readonly SearchResult[] {
  const key = `${query}\n${songs.map((song) => song.id).join("\n")}`;
  const [ranked, setRanked] = useState<{ key: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (songs.length < 2) return;
    const controller = new AbortController();
    const payload = songs.map((song) => ({
      id: song.id,
      title: song.title,
      artists: song.subtitle,
      durationMs: song.durationMs,
      album: Boolean(song.track?.album),
      preview: song.preview,
      plays: song.plays,
      verified: song.verified,
    }));
    rankSongIds(query, payload, controller.signal).then(
      (ids) => setRanked({ key, ids }),
      () => {},
    );
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!ranked || songs.length < 2) return songs;
    const byId = new Map(songs.map((song) => [song.id, song]));
    if (ranked.key === key) return ranked.ids.flatMap((id) => byId.get(id) ?? []);
    const place = new Map(ranked.ids.map((id, at) => [id, at]));
    const known = songs.filter((song) => place.has(song.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
    return [...known, ...songs.filter((song) => !place.has(song.id))];
  }, [ranked, songs, key]);
}
