import { useEffect, useMemo, useState } from "react";
import type { SearchItem, SearchKind } from "@/youtube";
import { isAbortError } from "@/youtube/types";
import { catalogSource } from "../catalog/source";
import { toUiTrack, type UiTrack } from "../catalog/tracks";

export type CatalogSearchItem = SearchItem;

export interface SearchOptions {
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
}

export interface Search<T> {
  items: T[];
  loading: boolean;
  hasLoaded: boolean;
  runNow(): void;
}

export type CatalogSearch = Search<SearchItem>;

export type SearchLoad<T> = (text: string, signal: AbortSignal) => Promise<T[]>;

export const MIN_QUERY = 2;
const DEFAULT_LIMIT = 20;
const DEFAULT_DEBOUNCE_MS = 300;
const NONE: never[] = [];

const CATALOG_LOADS = Object.fromEntries(
  (["all", "track", "artist", "album", "playlist"] as const).map((kind) => [
    kind,
    (text: string, signal: AbortSignal) => catalogSource()?.search(text, kind, signal) ?? Promise.resolve(NONE),
  ]),
) as Record<SearchKind, SearchLoad<SearchItem>>;

export function useCatalogSearch(query: string, kind: SearchKind, options: SearchOptions = {}): CatalogSearch {
  return useSearch(query, CATALOG_LOADS[kind], options);
}

export function useSearch<T>(query: string, load: SearchLoad<T>, options: SearchOptions = {}): Search<T> {
  const { enabled = true, limit = DEFAULT_LIMIT, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const text = query.trim();
  const active = enabled && text.length >= MIN_QUERY;
  const [result, setResult] = useState<{ query: string; items: T[] } | null>(null);
  const [urgent, setUrgent] = useState<{ text: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        load(text, controller.signal).then(
          (items) => {
            if (!controller.signal.aborted) setResult({ query: text, items: items.slice(0, limit) });
          },
          (error: unknown) => {
            if (!controller.signal.aborted && !isAbortError(error)) setResult({ query: text, items: NONE });
          },
        );
      },
      urgent?.text === text ? 0 : debounceMs,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, text, load, limit, debounceMs, urgent]);

  return {
    items: active && result ? result.items : NONE,
    loading: active && result?.query !== text,
    hasLoaded: active && result?.query === text,
    runNow: () => setUrgent({ text }),
  };
}

export function useSearchAll(query: string, options?: SearchOptions): CatalogSearch {
  return useCatalogSearch(query, "all", options);
}

export function useSearchTracks(query: string, options?: SearchOptions): CatalogSearch & { tracks: UiTrack[] } {
  const search = useCatalogSearch(query, "track", options);
  const tracks = useMemo(() => search.items.flatMap((item): UiTrack[] => (item.kind === "track" ? [toUiTrack(item)] : [])), [search.items]);
  return { ...search, tracks };
}

export function useSearchAlbums(query: string, options?: SearchOptions): CatalogSearch & { albums: SearchItem[] } {
  const search = useCatalogSearch(query, "album", options);
  return { ...search, albums: search.items };
}

export function useSearchArtists(query: string, options?: SearchOptions): CatalogSearch & { artists: SearchItem[] } {
  const search = useCatalogSearch(query, "artist", options);
  return { ...search, artists: search.items };
}

export function useSearchPlaylists(query: string, options?: SearchOptions): CatalogSearch & { playlists: SearchItem[] } {
  const search = useCatalogSearch(query, "playlist", options);
  return { ...search, playlists: search.items };
}
