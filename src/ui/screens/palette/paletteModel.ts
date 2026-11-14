import type { SearchKind, SearchResult } from "../../ports/search";

export const PALETTE_SONGS = 4;
export const PALETTE_COLLECTIONS = 3;

export interface PaletteResults {
  top: SearchResult | null;
  songs: SearchResult[];
  collections: SearchResult[];
}

const keyOf = (result: SearchResult) => `${result.kind}:${result.id}`;

// Library matches lead each group: they answer at once
export function paletteResults(local: readonly SearchResult[], online: readonly SearchResult[]): PaletteResults {
  const top = online[0] ?? local[0] ?? null;
  const seen = new Set(top ? [keyOf(top)] : []);
  const pick = (kinds: readonly SearchKind[], cap: number) => {
    const picked: SearchResult[] = [];
    for (const result of [...local, ...online]) {
      if (picked.length === cap) break;
      if (!kinds.includes(result.kind) || seen.has(keyOf(result))) continue;
      seen.add(keyOf(result));
      picked.push(result);
    }
    return picked;
  };
  return { top, songs: pick(["song"], PALETTE_SONGS), collections: pick(["playlist", "album"], PALETTE_COLLECTIONS) };
}
