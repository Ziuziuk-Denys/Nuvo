/**
 * The daemon's recognize routes for the Recognize screen. Files go by the id main granted, never by path; a link goes
 * as typed, and the daemon checks it (public hosts only, through the proxy) before yt-dlp reads it.
 */
import { CoreError, recognizeStream, send, type RecognizeEvent } from "@/links/core";
import type { RecognizedSong } from "./session";

export type RecognizeSource = { microphone: true } | { system: true } | { file: string } | { url: string };

export interface RecognizedEntry {
  id: string;
  createdAt: string;
  track: RecognizedSong;
}

/** Runs one job; every event goes to `onEvent`, the stream ends on the first answer. A stream that breaks reports `network`. */
export async function listen(source: RecognizeSource, part: 0 | 1, signal: AbortSignal, onEvent: (event: RecognizeEvent) => void): Promise<void> {
  const final = await recognizeStream<RecognizeEvent>(
    { ...source, part },
    signal,
    (event) => {
      if (event.type === "result" || event.type === "notFound" || event.type === "error") return event;
      onEvent(event);
      return null;
    },
    { type: "error", code: "network" },
  );
  onEvent(final);
}

/** The code for a job the daemon never started. */
export function startFailure(caught: unknown): string {
  if (caught instanceof CoreError && caught.status === 423) return "locked";
  if (caught instanceof CoreError && (caught.status === 0 || caught.status === 503)) return "core_down";
  return "failed";
}

export async function recognizeHistory(signal: AbortSignal): Promise<RecognizedEntry[]> {
  const response = await send("GET", "/v1/recognize/history", undefined, signal);
  return ((await response.json()) as { items: RecognizedEntry[] }).items;
}

export async function forgetRecognized(id: string): Promise<void> {
  await send("DELETE", `/v1/recognize/history/${encodeURIComponent(id)}`, undefined, new AbortController().signal);
}
