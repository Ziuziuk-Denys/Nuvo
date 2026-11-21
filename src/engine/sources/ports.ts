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
  durationMs?: number;
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
  kind: "direct" | "local" | "live";
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
  scStream(id: string, signal: AbortSignal, live?: boolean): Promise<ScDescriptor>;
  scLive(id: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  getAlternative(trackId: string): Promise<Alternative | null>;
  putAlternative(trackId: string, alternative: Alternative): Promise<void>;
  rejectAlternative(trackId: string, altId: string): Promise<void>;
  missingKept(limit: number): Promise<Track[]>;
  localUrl(trackId: string): string;
  probeLocal(trackId: string, signal?: AbortSignal): Promise<{ ok: true; probe: LocalProbe } | { ok: false; status: number }>;
}

export interface LiveFeed {
  url: string;
  whole: Promise<Blob>;
  overflowed(): boolean;
  release(): void;
}

export type FeedLive = (stream: ReadableStream<Uint8Array>, mime: string, durationMs: number | undefined, stop: () => void) => LiveFeed;

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
      if (!online) return new SourceFailure("offline");
      // One client answering means the connection works: a 403 on one stream is that video, not a blocked network
      const attempts = (Array.isArray(yt.attempts) ? yt.attempts : []).filter((attempt) => attempt?.code !== "paused");
      const every = (check: (attempt: { code: string; status?: number }) => boolean) => attempts.length > 0 && attempts.every(check);
      if (every((attempt) => attempt?.status === 403 || attempt?.status === 429) && attempts.some((attempt) => attempt?.status === 403))
        return new SourceFailure("blocked", { httpStatus: 403 });
      if (attempts.some((attempt) => attempt?.status === 429)) return new SourceFailure("rate_limited");
      if (every((attempt) => attempt?.code === "unreachable" || attempt?.code === "worker-timeout")) return new SourceFailure("blocked");
      return new SourceFailure("unavailable");
    }
    default:
      return new SourceFailure(online ? "unavailable" : "offline");
  }
}
