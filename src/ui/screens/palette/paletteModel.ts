import type { SearchResult } from "../../ports/search";
import { GROUP_KIND, uniqueResults, withSuggestions, type SearchFilter } from "../search/searchModel";

export const PALETTE_SONGS = 4;
export const PALETTE_OTHERS = 3;
const PALETTE_ARTISTS = 2;
const SUGGESTED_SONGS = PALETTE_SONGS - 1;

export interface PaletteSources {
  local: readonly SearchResult[];
  suggested: readonly SearchResult[];
  online: readonly SearchResult[];
}

export interface PaletteResults {
  top: SearchResult | null;
  songs: SearchResult[];
  others: SearchResult[];
}

export function paletteResults({ local, suggested, online }: PaletteSources): PaletteResults {
  const quickSongs = suggested.filter((result) => result.kind === "song").slice(0, SUGGESTED_SONGS);
  const quick = withSuggestions([...suggested.filter((result) => result.kind !== "song"), ...quickSongs], online);
  const first = suggested[0] ?? online[0] ?? local[0];
  const top = (first && quick.find((result) => result.kind === first.kind && result.id === first.id)) ?? first ?? null;
  const [, ...rest] = uniqueResults([...(top ? [top] : []), ...local, ...quick]);
  const songs = rest.filter((result) => result.kind === "song").slice(0, PALETTE_SONGS);
  const artists = rest.filter((result) => result.kind === "artist").slice(0, PALETTE_ARTISTS);
  const collections = rest.filter((result) => result.kind === "album" || result.kind === "playlist");
  return { top, songs, others: [...artists, ...collections].slice(0, PALETTE_OTHERS) };
}

export function filteredResults(
  { local, suggested, online }: PaletteSources,
  filter: Exclude<SearchFilter, "all">,
): { top: SearchResult | null; rest: SearchResult[] } {
  const ofKind = (results: readonly SearchResult[]) => results.filter((result) => result.kind === GROUP_KIND[filter]);
  const [top = null, ...rest] = uniqueResults([...withSuggestions(ofKind(suggested), ofKind(online)), ...ofKind(local)]);
  return { top, rest };
}
