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

const SUGGESTIONS_IN_FLIGHT = 2;

// Two requests may overlap: cancelling each one on the next key would answer only once typing stops
export function useSuggestions(query: string, enabled: boolean): SearchItem[] {
  const text = query.trim();
  const active = enabled && text.length >= MIN_QUERY;
  const [result, setResult] = useState<{ at: number; query: string; items: SearchItem[] } | null>(null);
  const [flight] = useState(() => ({ last: 0, running: [] as AbortController[] }));

  useEffect(() => {
    const catalog = active ? catalogSource() : null;
    if (!catalog) return;
    const controller = new AbortController();
    const at = ++flight.last;
    flight.running.push(controller);
    if (flight.running.length > SUGGESTIONS_IN_FLIGHT) flight.running.shift()?.abort();
    catalog
      .suggest(text, controller.signal)
      .then(
        (items) => {
          if (!controller.signal.aborted) setResult((shown) => (shown && shown.at > at ? shown : { at, query: text, items }));
        },
        () => undefined,
      )
      .finally(() => {
        flight.running = flight.running.filter((running) => running !== controller);
      });
  }, [active, text, flight]);

  useEffect(() => () => flight.running.forEach((controller) => controller.abort()), [flight]);

  // an answer for what was typed a key ago still fits; one for another word does not
  return active && result && (text.startsWith(result.query) || result.query.startsWith(text)) ? result.items : NONE;
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
