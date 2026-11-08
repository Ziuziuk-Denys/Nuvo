/** Artist, album and catalog playlist pages for the entity screens, from the YouTube catalog port. */
import { useCallback, useEffect, useState } from "react";
import type { AlbumPage, ArtistPage, ArtistRef, PlaylistPage, Release, YtCatalog } from "@/youtube";
import { isAbortError } from "@/youtube/types";
import { catalogSource } from "./source";
import { toUiTrack, type UiTrack } from "./tracks";

export interface ArtistRelease {
  id: string;
  title: string;
  releaseDate?: string;
  coverUrl: string;
}

export interface ArtistPageData {
  id: string;
  title: string;
  coverUrl: string;
  verified?: boolean;
  /** The catalog's own phrase, for example "61.5M monthly audience". */
  monthlyListeners?: string;
  tracks: UiTrack[];
  albums: ArtistRelease[];
  singles: ArtistRelease[];
}

export interface CollectionPageData {
  type: "album" | "playlist";
  id: string;
  title: string;
  coverUrl: string;
  tracks: UiTrack[];
  artists?: ArtistRef[];
  author?: string;
  year?: number;
}

export interface CatalogPage<T> {
  data: T | null;
  loading: boolean;
  /** The last load failed; any earlier data stays in `data`. */
  error: boolean;
  /** Loads the page again. */
  retry(): void;
}

type Loader<T> = (catalog: YtCatalog, id: string, signal: AbortSignal, partial: (value: T) => void) => Promise<T>;

/** Pages seen this session, so going back paints at once while the catalog is asked again. */
const CACHED_PAGES = 20;
const cache = new Map<string, unknown>();
const ARTIST_TIMEOUT_MS = 15_000;

function remember(key: string, value: unknown): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHED_PAGES) cache.delete(cache.keys().next().value!);
}

function release(item: Release): ArtistRelease {
  return { id: item.id, title: item.title, releaseDate: item.year ? String(item.year) : undefined, coverUrl: item.cover?.url ?? "" };
}

function toArtistPageData(page: ArtistPage): ArtistPageData {
  return {
    id: page.id,
    title: page.name,
    coverUrl: page.cover?.url ?? "",
    verified: page.verified,
    monthlyListeners: page.listenersText,
    tracks: page.tracks.map(toUiTrack),
    albums: page.albums.map(release),
    singles: page.singles.map(release),
  };
}

function toAlbumPageData(page: AlbumPage): CollectionPageData {
  return {
    type: "album",
    id: page.id,
    title: page.title,
    coverUrl: page.cover?.url ?? "",
    tracks: page.tracks.map(toUiTrack),
    artists: page.artists,
    year: page.year,
  };
}

function toPlaylistPageData(page: PlaylistPage): CollectionPageData {
  return {
    type: "playlist",
    id: page.id,
    title: page.title,
    coverUrl: page.cover?.url ?? "",
    tracks: page.tracks.map(toUiTrack),
    author: page.author,
    year: page.year,
  };
}

const loadArtist: Loader<ArtistPageData> = async (catalog, id, signal) => toArtistPageData(await catalog.artist(id, signal));
const loadAlbum: Loader<CollectionPageData> = async (catalog, id, signal) => toAlbumPageData(await catalog.album(id, signal));
/** A long playlist shows its first page, then the rest once loaded. */
const loadPlaylist: Loader<CollectionPageData> = async (catalog, id, signal, partial) => {
  const page = await catalog.playlist(id, signal);
  const first = toPlaylistPageData(page);
  if (!page.more) return first;
  partial(first);
  const rest = await page.more(signal);
  return { ...first, tracks: [...first.tracks, ...rest.map(toUiTrack)] };
};

interface PageState<T> {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: boolean;
  attempt: number;
}

function useCatalogPage<T>(key: string | null, id: string | null, load: Loader<T>): CatalogPage<T> {
  const cached = key ? ((cache.get(key) as T | undefined) ?? null) : null;
  const fresh: PageState<T> = { key, data: cached, loading: key !== null, error: false, attempt: 0 };
  const [state, setState] = useState<PageState<T>>(fresh);
  if (state.key !== key) setState(fresh);
  const retry = useCallback(() => setState((current) => ({ ...current, loading: true, error: false, attempt: current.attempt + 1 })), []);
  const attempt = state.key === key ? state.attempt : 0;

  useEffect(() => {
    if (key === null || id === null) return;
    const catalog = catalogSource();
    if (!catalog) {
      setState((current) => (current.key === key ? { ...current, loading: false } : current));
      return;
    }
    const controller = new AbortController();
    // an answer for a key the page has left is dropped, so a slow artist never replaces the one on screen
    const show = (data: T, loading: boolean) => {
      if (controller.signal.aborted) return;
      if (!loading) remember(key, data);
      setState((current) => ({ ...current, key, data, loading, error: false }));
    };
    load(catalog, id, controller.signal, (data) => show(data, true)).then(
      (data) => show(data, false),
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState((current) => (current.key === key ? { ...current, loading: false, error: true } : current));
      },
    );
    return () => controller.abort();
  }, [key, id, load, attempt]);

  return state.key === key
    ? { data: state.data, loading: state.loading, error: state.error, retry }
    : { data: cached, loading: key !== null, error: false, retry };
}

export function useArtist(id: string | null): CatalogPage<ArtistPageData> {
  return useCatalogPage(id ? `artist:${id}` : null, id, loadArtist);
}

export function useCollection(kind: "album" | "playlist", id: string | null): CatalogPage<CollectionPageData> {
  return useCatalogPage(id ? `${kind}:${id}` : null, id, kind === "album" ? loadAlbum : loadPlaylist);
}

/** The artist's first top song, to seed a station when nothing local does; undefined when the catalog fails. */
export async function artistTopTrack(id: string): Promise<UiTrack | undefined> {
  const catalog = catalogSource();
  if (!catalog) return undefined;
  try {
    return (await catalog.artist(id, AbortSignal.timeout(ARTIST_TIMEOUT_MS))).tracks.map(toUiTrack)[0];
  } catch {
    return undefined;
  }
}

const WHOLE_PAGE_TIMEOUT_MS = 30_000;

/** Every track of an artist's page or an album or catalog playlist, for Play on a library entry; empty when the catalog fails. */
export async function entityTracks(kind: "artist" | "album" | "playlist", id: string): Promise<UiTrack[]> {
  const catalog = catalogSource();
  if (!catalog) return [];
  const signal = AbortSignal.timeout(WHOLE_PAGE_TIMEOUT_MS);
  try {
    if (kind === "artist") return (await catalog.artist(id, signal)).tracks.map(toUiTrack);
    if (kind === "album") return (await catalog.album(id, signal)).tracks.map(toUiTrack);
    const page = await loadPlaylist(catalog, id, signal, () => undefined);
    return page.tracks;
  } catch {
    return [];
  }
}
