import { readCapped } from "./capped";
import type { MatchSource } from "./types";

export type FetchJson = (url: string, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;

export type SongLookup = { kind: "song"; source: MatchSource; isrc?: string } | { kind: "error"; code: "unavailable" | "region_blocked" | "network" };

const MAX_TEXT = 300;
const MAX_BODY_BYTES = 1024 * 1024;

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const bytes = await readCapped(response.body, MAX_BODY_BYTES);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export const fetchJson: FetchJson = async (url, signal) => {
  try {
    const response = await fetch(url, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    return {
      status: response.status,
      body: response.ok ? await readJson(response) : null,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 0, body: null };
  }
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function failed(status: number): SongLookup {
  return { kind: "error", code: status === 0 ? "network" : "unavailable" };
}

/** Accepted only when Apple says the id is a track (an album id returns a collection). */
export async function lookupApple(id: string, storefront: string, get: FetchJson, signal: AbortSignal): Promise<SongLookup> {
  const { status, body } = await get(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${encodeURIComponent(storefront)}`, signal);
  const item = (body as { results?: Record<string, unknown>[] } | null)?.results?.[0];
  const title = text(item?.trackName);
  if (!item || item.wrapperType !== "track" || !title) return failed(status);
  const artist = text(item.artistName);
  return {
    kind: "song",
    source: {
      title,
      artists: artist ? [artist] : [],
      durationMs: positive(item.trackTimeMillis),
    },
  };
}

export async function lookupDeezer(id: string, get: FetchJson, signal: AbortSignal): Promise<SongLookup> {
  const { status, body } = await get(`https://api.deezer.com/track/${encodeURIComponent(id)}`, signal);
  const item = body as {
    title?: unknown;
    artist?: { name?: unknown };
    duration?: unknown;
    isrc?: unknown;
    error?: unknown;
  } | null;
  const title = text(item?.title);
  if (!item || item.error || !title) return failed(status);
  const artist = text(item.artist?.name);
  const seconds = positive(item.duration);
  return {
    kind: "song",
    source: {
      title,
      artists: artist ? [artist] : [],
      durationMs: seconds ? seconds * 1000 : undefined,
    },
    isrc: text(item.isrc),
  };
}

export async function lookupYandex(id: string, get: FetchJson, signal: AbortSignal): Promise<SongLookup> {
  const { status, body } = await get(`https://api.music.yandex.net/tracks/${encodeURIComponent(id)}`, signal);
  if (status === 451 || status === 403) return { kind: "error", code: "region_blocked" };
  const item = (
    body as {
      result?: {
        title?: unknown;
        version?: unknown;
        artists?: { name?: unknown }[];
        durationMs?: unknown;
      }[];
    } | null
  )?.result?.[0];
  const title = text(item?.title);
  if (!item || !title) return failed(status);
  const version = text(item.version);
  const artists = (item.artists ?? []).map((artist) => text(artist.name)).filter((name): name is string => name !== undefined);
  return {
    kind: "song",
    source: {
      title: version ? `${title} (${version})` : title,
      artists,
      durationMs: positive(item.durationMs),
    },
  };
}

export async function lookupShazam(slug: string, id: string | undefined, get: FetchJson, signal: AbortSignal): Promise<SongLookup> {
  if (id) {
    const apple = await lookupApple(id, "us", get, signal);
    if (apple.kind === "song") return apple;
  }
  return {
    kind: "song",
    source: { title: slug.slice(0, MAX_TEXT), artists: [] },
  };
}
