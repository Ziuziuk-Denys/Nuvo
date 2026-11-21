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

const SKIP_CAUSES = new Set(["drm", "sign_in_required", "blocked", "stall", "media_error"]);
const FALLBACK_CAUSES = new Set(["drm", "sign_in_required", "blocked", "timeout", "stall", "http_403", "media_error"]);

export interface Translatable {
  key: string;
  vars: Record<string, string | number>;
}

export function skipNotice(title: string, cause: string, original: string = cause): Translatable {
  const vars = { title };
  if (original === "http_403" || (cause === "blocked" && original === cause)) return { key: "ui.island.skipped.refused", vars };
  if (cause === "offline") return { key: offlineMode.isOn() ? "ui.island.skipped.offline_mode" : "ui.island.skipped.offline", vars };
  if (cause === "timeout") return { key: "ui.island.skipped.timeout", vars };
  return { key: `ui.island.skipped.${SKIP_CAUSES.has(cause) ? cause : "unavailable"}`, vars };
}

export function fallbackReason(fallback: FallbackInfo): Translatable {
  const cause = FALLBACK_CAUSES.has(fallback.cause) ? fallback.cause : "unavailable";
  return { key: "ui.island.fallback_hover", vars: { source: SOURCE_LABEL[fallback.primarySource], reason: cause, score: fallback.score } };
}
