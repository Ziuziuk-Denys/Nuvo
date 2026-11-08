/**
 * The daemon routes the link features call, through Electron main's `nuvo-core://local` bridge (it adds
 * the token). Every call takes an AbortSignal; aborting the recognize stream makes the daemon kill its
 * child processes.
 */
import { CORE_BASE_URL } from "@/data/core/request";
import type { CatalogTrack, ImportRow, ImportTarget, MatchAnswer, MatchSource, MatchStep } from "./types";

/** Longest event the stream may hold unterminated; a daemon never sends more. */
const MAX_EVENT_BYTES = 256 * 1024;

export interface TikTokSound {
  title: string;
  author: string;
  original: boolean;
  album?: string;
  /** Length of the clip the post uses, never the song's length. */
  clipMs?: number;
}

export interface MediaInfo {
  title?: string;
  uploader?: string;
  track?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  isLive: boolean;
}

export type InspectAnswer =
  | { kind: "tiktok"; canonicalUrl: string; sound?: TikTokSound }
  | { kind: "media"; canonicalUrl: string; media: MediaInfo }
  | { kind: "redirect"; canonicalUrl: string }
  | { error: string };

export type ListenVia = "clean" | "mix" | "side";

/** What one recognize stream ended with. */
export type Heard =
  | {
      kind: "found";
      title: string;
      artist: string;
      isrc?: string;
      via: ListenVia;
    }
  | { kind: "not_found"; more: boolean }
  | { kind: "error"; code: string };

export interface ImportSummary {
  id: string;
  label: string;
  targetKind: string;
  targetId?: string;
  status: string;
  total: number;
}

export type SoundCloudItem =
  ({ type: "track" } & CatalogTrack) | { type: "album" | "playlist"; id: string; title: string } | { type: "artist"; id: string; name: string };

/** A failed daemon call: `status` 0 when the daemon could not be reached. */
export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export async function send(method: string, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${CORE_BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CoreError(0, "core_down");
  }
  if (!response.ok) {
    const answer = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    throw new CoreError(response.status, answer.code ?? "UPSTREAM");
  }
  return response;
}

async function call<T>(method: string, path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await send(method, path, body, signal);
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CoreError(response.status, "UPSTREAM");
  }
}

export function inspectLink(url: string, signal: AbortSignal): Promise<InspectAnswer> {
  return call("POST", "/v1/links/inspect", { url }, signal);
}

export function matchNext(
  request: {
    source: MatchSource;
    candidates: CatalogTrack[];
    steps: MatchStep[];
  },
  signal: AbortSignal,
): Promise<MatchAnswer> {
  return call("POST", "/v1/match/next", request, signal);
}

export function startImport(
  body: {
    source: "nuvo-link";
    label: string;
    rows: ImportRow[];
    target?: ImportTarget;
  },
  signal: AbortSignal,
): Promise<{ items: ImportSummary[] }> {
  return call("POST", "/v1/imports", body, signal);
}

export async function soundcloudLookup(url: string, signal: AbortSignal): Promise<SoundCloudItem | null> {
  const answer = await call<{ items: SoundCloudItem[] }>("GET", `/v1/sc/lookup?url=${encodeURIComponent(url)}&type=all`, undefined, signal);
  return answer.items[0] ?? null;
}

/** Null when SoundCloud says the track is gone. */
export async function soundcloudTrack(id: string, signal: AbortSignal): Promise<CatalogTrack | null> {
  try {
    return await call<CatalogTrack>("GET", `/v1/sc/tracks/${encodeURIComponent(id)}`, undefined, signal);
  } catch (error) {
    if (error instanceof CoreError && error.status === 404) return null;
    throw error;
  }
}

/** One event of the recognize stream, as the daemon sends it. */
export interface RecognizeEvent {
  type: string;
  id?: string;
  name?: string;
  via?: ListenVia;
  attempt?: number;
  of?: number;
  envelope?: number[];
  seconds?: number;
  detail?: string;
  code?: string;
  more?: boolean;
  title?: string;
  artist?: string;
  track?: {
    title: string;
    artist: string;
    isrc?: string;
    via: ListenVia;
  };
}

/**
 * Runs `POST /v1/recognize` and hands each event to `pick`; the first answer it returns ends the stream.
 * `lost` is the answer when the stream breaks or ends without one.
 */
export async function recognizeStream<T>(body: object, signal: AbortSignal, pick: (event: RecognizeEvent) => T | null, lost: T): Promise<T> {
  const response = await send("POST", "/v1/recognize", body, signal);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Handles one SSE block; a returned answer ends the stream.
  const handle = (block: string): T | null => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    let event: RecognizeEvent;
    try {
      event = JSON.parse(data);
    } catch {
      return null;
    }
    if (!event || typeof event !== "object") return null;
    return pick(event);
  };
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) throw error;
        return lost;
      }
      const { done, value } = chunk;
      if (done) {
        // an event the server closed the stream on, without the blank line
        return handle(buffer + decoder.decode()) ?? lost;
      }
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const answer = handle(block);
        if (answer !== null) return answer;
      }
      // only an unfinished event is left, so the cap applies to it alone
      if (buffer.length > MAX_EVENT_BYTES) return lost;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/**
 * Runs `POST /v1/recognize {url, part}` and returns its last event. `onListening` hears which audio is
 * being listened to, for the stage line.
 */
export function recognizeLink(url: string, part: 0 | 1, signal: AbortSignal, onListening: (via: ListenVia) => void): Promise<Heard> {
  const pick = (event: RecognizeEvent): Heard | null => {
    if (event.type === "stage" && event.name === "listening" && event.via) onListening(event.via);
    if (event.type === "result" && event.track)
      return {
        kind: "found",
        title: event.track.title,
        artist: event.track.artist,
        isrc: event.track.isrc,
        via: event.track.via,
      };
    if (event.type === "notFound") return { kind: "not_found", more: event.more === true };
    if (event.type === "error") return { kind: "error", code: event.code ?? "network" };
    return null;
  };
  return recognizeStream<Heard>({ url, part }, signal, pick, { kind: "error", code: "network" });
}
