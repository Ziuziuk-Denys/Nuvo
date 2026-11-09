// Files go by the id main granted, never by path; the daemon checks links before yt-dlp
import { CoreError, recognizeStream, send, type RecognizeEvent } from "@/links/core";
import type { RecognizedSong } from "./session";

export type RecognizeSource = { microphone: true } | { system: true } | { file: string } | { url: string };

export interface RecognizedEntry {
  id: string;
  createdAt: string;
  track: RecognizedSong;
}

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
