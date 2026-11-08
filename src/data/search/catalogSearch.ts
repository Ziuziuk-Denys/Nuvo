/** Catalog search for the search page: debounced, one request per settled query, older answers never shown as current. */
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

export interface CatalogSearch {
  items: SearchItem[];
  /** True from the first keystroke until the answer for this exact query arrives. */
  loading: boolean;
  hasLoaded: boolean;
  runNow(): void;
}

/** Shorter queries are not sent; the page's "searching" and "no results" lines start at two characters too. */
export const MIN_QUERY = 2;
const DEFAULT_LIMIT = 20;
const DEFAULT_DEBOUNCE_MS = 300;
const NONE: SearchItem[] = [];

export function useCatalogSearch(query: string, kind: SearchKind, options: SearchOptions = {}): CatalogSearch {
  const { enabled = true, limit = DEFAULT_LIMIT, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const text = query.trim();
  const active = enabled && text.length >= MIN_QUERY;
  const [result, setResult] = useState<{ query: string; items: SearchItem[] } | null>(null);
  const [urgent, setUrgent] = useState<{ text: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        const catalog = catalogSource();
        if (!catalog) {
          setResult({ query: text, items: NONE });
          return;
        }
        catalog.search(text, kind, controller.signal).then(
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
  }, [active, text, kind, limit, debounceMs, urgent]);

  // the last answer stays on screen while the next query runs; `loading` says it is not this query's
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
