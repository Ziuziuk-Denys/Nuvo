import type { Cause, FallbackInfo, Track } from "../types";

export interface PlayableSource {
  url?: string;
  expiresAt?: number;
  progressive?: { url: string; whole: Promise<Blob>; overflowed(): boolean; release(): void };
  bytes?: Blob;
  mimeType: string;
  codec: string;
  bitrate: number;
  sizeBytes?: number;
  servedBy?: string;
  verify?: () => Promise<PlayableSource>;
}

export interface YoutubePort {
  resolve(
    track: Track,
    options: { progressive: boolean; early?: boolean; quality?: "normal" | "hifi"; codec?: string; avoid?: string[] },
    signal: AbortSignal,
  ): Promise<PlayableSource>;
  fetchWhole(source: PlayableSource, signal: AbortSignal): Promise<Blob>;
  warmUp(): void;
}

export interface YtErrorLike {
  code: string;
  status?: number;
  botCheck?: boolean;
  attempts?: Array<{ code: string; status?: number }>;
}

export interface ScDescriptor {
  kind: "direct" | "local";
  url: string;
  expiresAt: number | null;
  codec: string;
  mimeType: string;
  bitrate: number;
  contentLength: number | null;
}

export interface CacheProbe {
  codec: string | null;
  bitrateKbps: number | null;
}

export interface Alternative {
  source: "youtube" | "soundcloud";
  altId: string;
  score: number;
  reason: string;
  durationMs?: number;
}

export interface FetchJob {
  state: "queued" | "fetching" | "done" | "failed";
  bytes: number;
  code?: string;
}

export interface FetchStatusResult {
  http: number;
  job: FetchJob | null;
}

export interface LocalProbe {
  codec: string;
  bitrateKbps: number | null;
  mime: string;
}

export interface DaemonPort {
  probeCache(trackId: string, signal?: AbortSignal): Promise<CacheProbe | null>;
  cacheUrl(trackId: string): string;
  deleteCache(trackId: string): Promise<void>;
  putCache(trackId: string, body: Blob, mime: string, codec: string, bitrateKbps: number): Promise<number>;
  startFetch(job: { trackId: string; url: string; mime: string; codec: string; bitrateKbps: number; contentLength?: number }): Promise<number>;
  fetchStatus(trackId: string, signal?: AbortSignal): Promise<FetchStatusResult>;
  cancelFetch(trackId: string): Promise<void>;
  scStream(id: string, signal: AbortSignal): Promise<ScDescriptor>;
  getAlternative(trackId: string): Promise<Alternative | null>;
  putAlternative(trackId: string, alternative: Alternative): Promise<void>;
  rejectAlternative(trackId: string, altId: string): Promise<void>;
  missingKept(limit: number): Promise<Track[]>;
  localUrl(trackId: string): string;
  probeLocal(trackId: string, signal?: AbortSignal): Promise<{ ok: true; probe: LocalProbe } | { ok: false; status: number }>;
}

export interface MatchPort {
  approvedOn(
    target: "youtube" | "soundcloud",
    track: Track,
    signal: AbortSignal,
    exclude?: ReadonlySet<string>,
  ): Promise<{ track: Track; score: number } | null>;
}

export class SourceFailure extends Error {
  constructor(
    readonly cause: Cause,
    readonly detail: { botCheck?: boolean; signIn?: boolean; httpStatus?: number; original?: FallbackInfo["cause"] } = {},
  ) {
    super(cause);
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string })?.name === "AbortError";
}

export function youtubeCause(error: unknown, online: boolean): SourceFailure {
  if (error instanceof SourceFailure) return error;
  const yt = error as YtErrorLike;
  switch (yt?.code) {
    case "bot-check":
      return new SourceFailure("sign_in_required", { botCheck: true });
    case "sign-in-required":
      return new SourceFailure("sign_in_required");
    case "unreachable":
      return new SourceFailure(online ? "blocked" : "offline");
    case "http":
      if (yt.status === 403) return new SourceFailure("blocked", { httpStatus: 403 });
      if (yt.status === 429) return new SourceFailure("rate_limited");
      if ((yt.status ?? 0) >= 500) return new SourceFailure("server_error");
      return new SourceFailure("unavailable");
    case "rejected-stream":
    case "unsupported-mime":
      return new SourceFailure("not_audio");
    case "worker-timeout":
      return new SourceFailure("timeout");
    case "all-failed": {
      if (yt.botCheck) return new SourceFailure("sign_in_required", { botCheck: true });
      const statuses = (Array.isArray(yt.attempts) ? yt.attempts : []).map((attempt) => attempt?.status);
      if (statuses.includes(403)) return new SourceFailure("blocked", { httpStatus: 403 });
      if (statuses.includes(429)) return new SourceFailure("rate_limited");
      if (!online) return new SourceFailure("offline");
      const attempts = (Array.isArray(yt.attempts) ? yt.attempts : []).filter((attempt) => attempt?.code !== "paused");
      const silent = attempts.length > 0 && attempts.every((attempt) => attempt?.code === "unreachable" || attempt?.code === "worker-timeout");
      return new SourceFailure(silent ? "blocked" : "unavailable");
    }
    default:
      return new SourceFailure(online ? "unavailable" : "offline");
  }
}
