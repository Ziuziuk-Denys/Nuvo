import type { FallbackInfo, PlayerView, SourceKind, StreamInfo } from "./types";
import { offlineMode } from "./offlineMode";

export interface StateLine {
  key: "deviceLost" | "playedFrom" | "restarted" | "station" | "sleep" | "bestQuality";
  params: Record<string, string | number>;
}

const CODEC_LABEL: Record<string, string> = { opus: "Opus", aac: "AAC", mp4a: "AAC", mp3: "MP3", vorbis: "Vorbis", flac: "FLAC" };
const SOURCE_LABEL: Record<SourceKind, string> = { youtube: "YouTube", soundcloud: "SoundCloud", cache: "cache", local: "local file" };

export const sourceLabel = (source: SourceKind): string => SOURCE_LABEL[source];

export function codecLabel(codec: string): string {
  const key = codec.toLowerCase().split(".")[0];
  return CODEC_LABEL[key] ?? codec;
}

export function stateLine(view: PlayerView, extra: { sleepRemainingMs?: number | null; stationTitle?: string } = {}): StateLine | null {
  if (view.status === "paused" && view.pauseReason === "device_lost") return { key: "deviceLost", params: {} };
  if (view.fallback) {
    return view.fallback.restarted
      ? { key: "restarted", params: { source: SOURCE_LABEL[view.fallback.usedSource] } }
      : { key: "playedFrom", params: { source: SOURCE_LABEL[view.fallback.usedSource] } };
  }
  if (view.context?.startsWith("radio:")) return { key: "station", params: { title: extra.stationTitle ?? "" } };
  if (extra.sleepRemainingMs !== undefined && extra.sleepRemainingMs !== null) return { key: "sleep", params: { remainingMs: extra.sleepRemainingMs } };
  if (view.bestQuality && view.stream) return { key: "bestQuality", params: { codec: codecLabel(view.stream.codec), kbps: view.stream.bitrateKbps } };
  return null;
}

export const STATE_LINE_EN: Record<StateLine["key"], (p: Record<string, string | number>) => string> = {
  deviceLost: () => "Paused · headphones disconnected",
  playedFrom: (p) => `Played from ${p.source}`,
  restarted: () => "Restarted: different length",
  station: (p) => (p.title ? `Station · ${p.title}` : "Station"),
  sleep: (p) => `Sleep in ${Math.ceil(Number(p.remainingMs) / 60_000)} min`,
  bestQuality: (p) => `Best quality · ${p.codec} ${p.kbps}`,
};

export const STATE_LINE_RU: Partial<Record<StateLine["key"], (p: Record<string, string | number>) => string>> = {
  deviceLost: () => "Пауза · наушники отключены",
  playedFrom: (p) => `Играет с ${p.source}`,
  restarted: () => "Перезагружено: другая длительность",
  station: (p) => (p.title ? `Станция · ${p.title}` : "Станция"),
  sleep: (p) => `Сон через ${Math.ceil(Number(p.remainingMs) / 60_000)} мин`,
  bestQuality: (p) => `Лучшее качество · ${p.codec} ${p.kbps}`,
};

export function streamHover(stream: StreamInfo): string {
  const where = stream.fromCache ? "from cache" : SOURCE_LABEL[stream.source];
  return `${codecLabel(stream.codec)} · ${stream.bitrateKbps} kbps · ${where}`;
}

const CAUSE_TEXT: Record<string, string> = {
  unavailable: "unavailable in your region",
  drm: "protected",
  sign_in_required: "needs sign-in",
  blocked: "blocked",
  timeout: "timed out",
  stall: "stalled",
  http_403: "refused this connection",
  media_error: "could not be decoded",
};

export function skipText(title: string, cause: string, original: string = cause): string {
  if (original === "http_403" || (cause === "blocked" && original === cause))
    return `${title} skipped. YouTube refuses this connection; try another network or check your proxy.`;
  if (cause === "offline") return `${title} skipped. ${offlineMode.isOn() ? "Offline mode is on" : "You are offline"}.`;
  if (cause === "timeout") return `${title} skipped. No source answered in time; it will be tried again later.`;
  return `${title} skipped. ${CAUSE_TEXT[cause] ?? "No source could play it"}.`.replace(/\. ([a-z])/, (_, letter: string) => `. ${letter.toUpperCase()}`);
}

export function fallbackHover(fallback: FallbackInfo): string {
  const cause = CAUSE_TEXT[fallback.cause] ?? fallback.cause;
  const head = `${SOURCE_LABEL[fallback.primarySource]}: ${cause}. Matched by title, artist and length (score ${fallback.score}). May be a different recording.`;
  return fallback.restarted ? `${head} Restarted: different length` : head;
}
