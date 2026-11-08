/** Ports the source layer consumes. Implemented by the YouTube module, the daemon client and the matching adapter. */
import type { Cause, FallbackInfo, Track } from "../types";

/** What the YouTube module hands back for a track. Exactly one of `url`, `progressive`, `bytes` is set. */
export interface PlayableSource {
  url?: string;
  /** Unix ms after which the URL stops working. */
  expiresAt?: number;
  progressive?: { url: string; whole: Promise<Blob>; overflowed(): boolean; release(): void };
  bytes?: Blob;
  mimeType: string;
  codec: string;
  /** Bits per second, average when known, else nominal. */
  bitrate: number;
  sizeBytes?: number;
  /** The client that produced the stream. */
  servedBy?: string;
  /** Early starts: runs the probe; settles with this source once it passed, or the replacement found after it failed. */
  verify?: () => Promise<PlayableSource>;
}

export interface YoutubePort {
  /** `early`: the URL may come back before its probe, with `verify`. `avoid`: clients whose stream already failed. */
  resolve(
    track: Track,
    options: { progressive: boolean; early?: boolean; quality?: "normal" | "hifi"; codec?: string; avoid?: string[] },
    signal: AbortSignal,
  ): Promise<PlayableSource>;
  fetchWhole(source: PlayableSource, signal: AbortSignal): Promise<Blob>;
  warmUp(): void;
}

/** Shape of the YouTube module's errors (`YtError`). */
export interface YtErrorLike {
  code: string;
  status?: number;
  botCheck?: boolean;
  /** `all-failed` only: one entry per tried client; `status` is the HTTP status when the attempt failed on one. */
  attempts?: Array<{ code: string; status?: number }>;
}

export interface ScDescriptor {
  kind: "direct" | "local";
  url: string;
  /** Unix ms, parsed by the daemon client from the ISO time on the wire; null when unknown. */
  expiresAt: number | null;
  codec: string;
  mimeType: string;
  /** Bits per second. */
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
  /** Duration of the alternative track, for the same-position rule. */
  durationMs?: number;
}

export interface FetchJob {
  state: "queued" | "fetching" | "done" | "failed";
  bytes: number;
  code?: string;
}

/** `http` is 0 when the daemon is unreachable, 404 for an unknown job; `job` is set only for a readable 2xx answer. */
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
  /** null on a miss, a timeout (1.5 s) or an unreachable daemon. */
  probeCache(trackId: string, signal?: AbortSignal): Promise<CacheProbe | null>;
  cacheUrl(trackId: string): string;
  deleteCache(trackId: string): Promise<void>;
  /** HTTP status, 0 when unreachable. */
  putCache(trackId: string, body: Blob, mime: string, codec: string, bitrateKbps: number): Promise<number>;
  /** HTTP status, 0 when unreachable. */
  startFetch(job: { trackId: string; url: string; mime: string; codec: string; bitrateKbps: number; contentLength?: number }): Promise<number>;
  fetchStatus(trackId: string, signal?: AbortSignal): Promise<FetchStatusResult>;
  cancelFetch(trackId: string): Promise<void>;
  scStream(id: string, signal: AbortSignal): Promise<ScDescriptor>;
  getAlternative(trackId: string): Promise<Alternative | null>;
  putAlternative(trackId: string, alternative: Alternative): Promise<void>;
  rejectAlternative(trackId: string, altId: string): Promise<void>;
  missingKept(limit: number): Promise<Track[]>;
  /** The daemon URL of a file in a music folder. */
  localUrl(trackId: string): string;
  /** One-byte read of a local file; `status` 404 when it is gone, 415 when it cannot play, 0 when unreachable. */
  probeLocal(trackId: string, signal?: AbortSignal): Promise<{ ok: true; probe: LocalProbe } | { ok: false; status: number }>;
}

/** The matching cascade, reduced to the one question fallback asks. Only approved outcomes come back. */
export interface MatchPort {
  /** `exclude`: candidate ids already tried or rejected, so the cascade moves to the next candidate. */
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
    /** `original`: the trigger the start failed with, when `cause` is its display form (media_error, stall, http_403). */
    readonly detail: { botCheck?: boolean; signIn?: boolean; httpStatus?: number; original?: FallbackInfo["cause"] } = {},
  ) {
    super(cause);
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string })?.name === "AbortError";
}

/** Maps a YouTube module error to the cause vocabulary. */
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
      // the worst reason wins: a bot check offers sign-in, a 403 means blocked, a 429 means slow down
      if (yt.botCheck) return new SourceFailure("sign_in_required", { botCheck: true });
      const statuses = (Array.isArray(yt.attempts) ? yt.attempts : []).map((attempt) => attempt?.status);
      if (statuses.includes(403)) return new SourceFailure("blocked", { httpStatus: 403 });
      if (statuses.includes(429)) return new SourceFailure("rate_limited");
      if (!online) return new SourceFailure("offline");
      // No client got an answer at all: the way out is closed, the video is not to blame.
      const attempts = (Array.isArray(yt.attempts) ? yt.attempts : []).filter((attempt) => attempt?.code !== "paused");
      const silent = attempts.length > 0 && attempts.every((attempt) => attempt?.code === "unreachable" || attempt?.code === "worker-timeout");
      return new SourceFailure(silent ? "blocked" : "unavailable");
    }
    default:
      return new SourceFailure(online ? "unavailable" : "offline");
  }
}
