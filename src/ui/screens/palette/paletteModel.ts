import type { SearchKind, SearchResult } from "../../ports/search";
import { songKey } from "../search/searchModel";

export const PALETTE_SONGS = 4;
export const PALETTE_ARTISTS = 3;
export const PALETTE_COLLECTIONS = 3;
const SUGGESTED_SONGS = PALETTE_SONGS - 1;

export interface PaletteSources {
  local: readonly SearchResult[];
  suggested: readonly SearchResult[];
  online: readonly SearchResult[];
}

export interface PaletteResults {
  top: SearchResult | null;
  songs: SearchResult[];
  artists: SearchResult[];
  collections: SearchResult[];
}

const keyOf = (result: SearchResult) => `${result.kind}:${result.id}`;

// Suggestions answer first and keep their place, so later results only add rows
export function paletteResults({ local, suggested, online }: PaletteSources): PaletteResults {
  const richer = new Map(online.map((result) => [keyOf(result), result]));
  const quick = suggested.map((result) => (result.track ? (richer.get(keyOf(result)) ?? result) : result));
  const top = quick[0] ?? online[0] ?? local[0] ?? null;
  const seen = new Set<string>();
  const fresh = (result: SearchResult) => {
    const keys = result.kind === "song" ? [keyOf(result), songKey(result)] : [keyOf(result)];
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  };
  if (top) fresh(top);
  const pick = (kinds: readonly SearchKind[], cap: number, from: readonly SearchResult[]) => {
    const picked: SearchResult[] = [];
    for (const result of from) {
      if (picked.length === cap) break;
      if (kinds.includes(result.kind) && fresh(result)) picked.push(result);
    }
    return picked;
  };
  const quickSongs = quick.filter((result) => result.kind === "song").slice(0, SUGGESTED_SONGS);
  return {
    top,
    songs: pick(["song"], PALETTE_SONGS, [...local, ...quickSongs, ...online]),
    artists: pick(["artist"], PALETTE_ARTISTS, [...quick, ...online]),
    collections: pick(["playlist", "album"], PALETTE_COLLECTIONS, [...local, ...quick, ...online]),
  };
}
