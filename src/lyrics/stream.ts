/** The daemon's lyrics routes: the renderer's only lyrics network path. */
import type { Track } from "@/engine/types";
import type { RawLyrics, StreamEvent } from "./types";

export const CORE_URL = "nuvo-core://local";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Title, the first non-empty artist name, and the duration when positive. */
export function streamUrl(track: Track): string {
  const fromList = (track.artistList ?? []).map((artist) => artist.name.trim()).find((name) => name !== "");
  const artist = fromList ?? (track.artists.split(",")[0] ?? "").trim();
  const params = new URLSearchParams();
  if (track.title.trim() !== "") params.set("title", track.title.trim());
  if (artist !== "") params.set("artist", artist);
  if (track.durationMs > 0) params.set("durationMs", String(Math.round(track.durationMs)));
  return `${CORE_URL}/v1/tracks/${encodeURIComponent(track.id)}/lyrics?${params}`;
}

function toEvent(block: string): StreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (data === "") return null;
  try {
    const event = JSON.parse(data) as StreamEvent | null;
    return typeof event?.type === "string" ? event : null;
  } catch {
    return null;
  }
}

/** Size caps count UTF-16 units, close enough to bytes for a JSON text stream. */
export const MAX_EVENT_BYTES = 256 * 1024;
export const MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_RECONNECTS = 3;
const BACKOFF_MS = 250;

class StreamLimitError extends Error {}
class StreamStatusError extends Error {
  constructor(readonly status: number) {
    super(`lyrics stream answered ${status}`);
  }
}

function checked(block: string): StreamEvent | null {
  if (block.length > MAX_EVENT_BYTES) throw new StreamLimitError("lyrics stream event too large");
  return toEvent(block);
}

/** One connection; returns true when the daemon sent its `done` event. */
async function* readOnce(fetcher: Fetch, url: string, signal: AbortSignal): AsyncGenerator<StreamEvent, boolean> {
  const response = await fetcher(url, { signal, headers: { Accept: "text/event-stream" } });
  if (!response.ok || !response.body) throw new StreamStatusError(response.status);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // CRLF becomes LF on the whole buffer, so a pair cut between chunks still joins
      buffer = (buffer + value).replace(/\r\n/g, "\n");
      if (buffer.length > MAX_BUFFER_BYTES) throw new StreamLimitError("lyrics stream buffer too large");
      for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
        const event = checked(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (event) {
          if (event.type === "done") finished = true;
          yield event;
        }
      }
      if (buffer.length > MAX_EVENT_BYTES) throw new StreamLimitError("lyrics stream event too large");
    }
    const last = checked(buffer);
    if (last) {
      if (last.type === "done") finished = true;
      yield last;
    }
    return finished;
  } finally {
    // the consumer stopped early (track change): drop the daemon connection too
    void reader.cancel().catch(() => undefined);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Server-sent events: one JSON object per `data:` line, events split by a blank line.
 * A dropped stream (network error, 5xx, end without `done`) reconnects up to 3 times with growing delays.
 * The daemon replays its events on a new connection, so a consumer may see an early event twice.
 * An abort, a 4xx answer or a size-limit error ends the stream at once.
 */
export async function* readLyricsStream(fetcher: Fetch, url: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  for (let attempt = 0; ; attempt += 1) {
    let failure: Error;
    try {
      if (yield* readOnce(fetcher, url, signal)) return;
      failure = new Error("lyrics stream ended before done");
    } catch (error) {
      const fatal = signal.aborted || error instanceof StreamLimitError || (error instanceof StreamStatusError && error.status < 500);
      if (fatal) throw error;
      failure = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt >= MAX_RECONNECTS) throw failure;
    await wait(BACKOFF_MS * 2 ** attempt, signal);
  }
}

async function put(fetcher: Fetch, route: string, body: unknown): Promise<void> {
  const response = await fetcher(`${CORE_URL}${route}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
}

export function putOffset(fetcher: Fetch, trackId: string, offsetMs: number): Promise<void> {
  return put(fetcher, `/v1/tracks/${encodeURIComponent(trackId)}/lyrics/offset`, { offsetMs });
}

/** The one-time import of the legacy renderer map. */
export function putOffsets(fetcher: Fetch, offsets: Record<string, number>): Promise<void> {
  return put(fetcher, "/v1/lyrics/offsets", { offsets });
}

const userRoute = (trackId: string) => `/v1/tracks/${encodeURIComponent(trackId)}/lyrics/user`;

export function putUserLyrics(fetcher: Fetch, trackId: string, lyrics: { format: "lrc" | "plain"; content: string }): Promise<void> {
  return put(fetcher, userRoute(trackId), lyrics);
}

export async function deleteUserLyrics(fetcher: Fetch, trackId: string): Promise<void> {
  const response = await fetcher(`${CORE_URL}${userRoute(trackId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`user lyrics delete answered ${response.status}`);
}

/** The text the editor starts from: the user's own lyrics, else a synced version, else plain. */
export async function editableLyrics(fetcher: Fetch, track: Track, signal: AbortSignal): Promise<RawLyrics | null> {
  let best: { lyrics: RawLyrics; rank: number } | null = null;
  for await (const event of readLyricsStream(fetcher, streamUrl(track), signal)) {
    if (event.type !== "provider" || event.status !== "found" || !event.candidate) continue;
    const rank = event.candidate.topPriority ? 2 : event.candidate.lyrics.format === "lrc" ? 1 : 0;
    if (!best || rank > best.rank) best = { lyrics: event.candidate.lyrics, rank };
  }
  return best?.lyrics ?? null;
}

/** No local model answers on the configured loopback address. */
export class NoTranslatorError extends Error {}

/** The daemon holds the translator's address; a request carries only the language and the lines. */
export async function translateLines(fetcher: Fetch, request: { lang: string; lines: string[] }, signal?: AbortSignal): Promise<string[]> {
  const response = await fetcher(`${CORE_URL}/v1/lyrics/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (response.status === 409) throw new NoTranslatorError("no local model answers");
  if (!response.ok) throw new Error(`translate answered ${response.status}`);
  return ((await response.json()) as { lines: string[] }).lines;
}

/** Stores the default local model through the daemon's validated settings route, once. */
export async function ensureTranslator(fetcher: Fetch, defaults: { endpoint: string; model: string }): Promise<void> {
  const response = await fetcher(`${CORE_URL}/v1/lyrics/translator`);
  if (!response.ok) throw new Error(`translator settings answered ${response.status}`);
  const stored = (await response.json()) as { endpoint: string | null };
  if (stored.endpoint === null) await put(fetcher, "/v1/lyrics/translator", defaults);
}
