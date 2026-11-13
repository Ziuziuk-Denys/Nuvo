import type { Track } from "@/engine/types";
import { toPlayerTrack } from "@/links/playerTrack";
import type { CatalogTrack } from "@/links/types";
import { CORE_BASE_URL } from "../core/request";
import { useSearch, type Search, type SearchOptions } from "./catalogSearch";

const SEARCH_TIMEOUT_MS = 45_000;

export interface SoundCloudHit {
  track: Track;
  preview: boolean;
}

export async function searchSoundCloud(text: string, signal: AbortSignal): Promise<SoundCloudHit[]> {
  const params = new URLSearchParams({ q: text });
  const response = await fetch(`${CORE_BASE_URL}/v1/sc/search?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]) });
  if (!response.ok) throw new Error(`SoundCloud search answered ${response.status}`);
  const answer = (await response.json()) as { items: Array<CatalogTrack & { preview?: boolean }> };
  return answer.items.map((item) => ({ track: toPlayerTrack(item), preview: item.preview === true }));
}

export function useSoundCloudSearch(query: string, options?: SearchOptions): Search<SoundCloudHit> {
  return useSearch(query, searchSoundCloud, options);
}
