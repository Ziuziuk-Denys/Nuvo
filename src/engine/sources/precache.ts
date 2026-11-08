/** Background cache writes, pre-cache of the next track and idle prefetch of kept tracks. */
import type { PrecacheLike } from "../engine";
import { isLocalId, type Status, type Track } from "../types";
import type { DaemonPort } from "./ports";
import type { Resolved, ResolveOptions } from "./resolver";
import { checkCacheWrite } from "./sniff";

export const PRECACHE_ARM_MS = 10_000;
export const FETCH_POLL_MS = 2000;
export const IDLE_PREFETCH_AFTER_MS = 30_000;
export const FETCH_TRANSIENT_LIMIT = 3;
export const FAILED_RETRY_MS = 3600_000;
export const BACKGROUND_CACHE_MAX_MS = 20 * 60_000;

export interface PrecacheDeps {
  daemon: DaemonPort;
  resolve(track: Track, options: ResolveOptions): Promise<Resolved>;
  isCached(trackId: string): Promise<boolean>;
  markCached(trackId: string): void;
  now(): number;
  log(message: string, error?: unknown): void;
}

interface Job {
  trackId: string;
  controller: AbortController;
  pathA: boolean;
  /** Resolves once the daemon answered the job start, so a cancel never overtakes it. */
  starting: Promise<unknown> | null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });

export class PrecacheScheduler implements PrecacheLike {
  private next: Track | null = null;
  private job: Job | null = null;
  /** The next track whose pre-cache failed; it is not retried until the next entry changes. */
  private failedNextId: string | null = null;
  private epoch = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idle: AbortController | null = null;
  private disposed = false;
  private readonly failedAt = new Map<string, number>();
  /** The one Blob path B may hold; dropped as soon as its PUT resolves. */
  heldBlob: Blob | null = null;

  constructor(private readonly deps: PrecacheDeps) {}

  setNext(track: Track | null): void {
    if (this.next?.id === track?.id) return;
    this.next = track;
    this.failedNextId = null;
    if (this.job && this.job.trackId !== track?.id) this.cancelJob();
  }

  tick(_entryId: string, positionMs: number, playing: boolean, steadyFromMs: number): void {
    if (!playing || !this.next || isLocalId(this.next.id) || this.job || this.next.id === this.failedNextId || positionMs - steadyFromMs < PRECACHE_ARM_MS)
      return;
    void this.cacheNext(this.next);
  }

  statusChanged(status: Status): void {
    if (this.disposed) return;
    if (status === "playing" || status === "loading") {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = null;
      this.idle?.abort();
      this.idle = null;
      return;
    }
    if (this.idleTimer || this.idle) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.idlePrefetch();
    }, IDLE_PREFETCH_AFTER_MS);
  }

  /** After a network start the playing track is cached in the background (path A or B). */
  started(track: Track, resolved: Resolved): void {
    if (this.disposed) return;
    if (resolved.stream.source === "local" || resolved.stream.fromCache || track.durationMs > BACKGROUND_CACHE_MAX_MS) return;
    void this.store(track, resolved, new AbortController().signal).catch((error) => this.deps.log("background cache failed", error));
  }

  cancelAll(): void {
    this.epoch += 1;
    this.cancelJob();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idle?.abort();
    this.idle = null;
  }

  /** Final stop: nothing prefetches or uploads afterwards. */
  dispose(): void {
    this.disposed = true;
    this.cancelAll();
  }

  private cancelJob(): void {
    const job = this.job;
    if (!job) return;
    this.job = null;
    job.controller.abort();
    if (job.pathA) void (job.starting ?? Promise.resolve()).then(() => this.deps.daemon.cancelFetch(job.trackId));
  }

  /** Saves: caches one track now, outside the next-track slot. True once the daemon has it. */
  async ensureCached(track: Track, signal: AbortSignal): Promise<boolean> {
    if (await this.deps.isCached(track.id)) return true;
    const resolved = await this.deps.resolve(track, { positionMs: 0, bypassCache: true, bestQuality: false, signal });
    try {
      return await this.store(track, resolved, signal);
    } finally {
      resolved.source.release();
    }
  }

  private async cacheNext(track: Track): Promise<void> {
    const job: Job = { trackId: track.id, controller: new AbortController(), pathA: false, starting: null };
    this.job = job;
    try {
      if (await this.deps.isCached(track.id)) return;
      if (job.controller.signal.aborted) return;
      const resolved = await this.deps.resolve(track, { positionMs: 0, bypassCache: true, bestQuality: false, signal: job.controller.signal });
      try {
        const cached = await this.store(track, resolved, job.controller.signal, job);
        if (!cached && !job.controller.signal.aborted) this.failedNextId = track.id;
      } finally {
        resolved.source.release();
      }
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") {
        this.deps.log("pre-cache failed", error);
        this.failedNextId = track.id;
      }
    } finally {
      if (this.job === job) this.job = null;
    }
  }

  /** Path A for URL streams (the daemon downloads), path B for bytes the renderer already holds. True once the track is cached. */
  private async store(track: Track, resolved: Resolved, signal: AbortSignal, job?: Job): Promise<boolean> {
    const epoch = this.epoch;
    if (resolved.fetchable) {
      const result = await this.pathA(track.id, resolved.fetchable, signal, job);
      if (result === "done") {
        this.deps.markCached(track.id);
        return true;
      }
      if (result === "unavailable" && resolved.wholeFile) {
        if (job) job.pathA = false;
        const blob = await resolved.wholeFile(signal);
        return this.pathB(track.id, blob, resolved, epoch);
      }
      return false;
    }
    if (resolved.source.bytes) return this.pathB(track.id, resolved.source.bytes, resolved, epoch);
    if (resolved.source.whole) {
      const blob = await resolved.source.whole;
      return this.pathB(track.id, blob, resolved, epoch);
    }
    return false;
  }

  private async pathA(
    trackId: string,
    fetchable: NonNullable<Resolved["fetchable"]>,
    signal: AbortSignal,
    job?: Job,
  ): Promise<"done" | "failed" | "unavailable"> {
    const starting = this.deps.daemon.startFetch({ trackId, ...fetchable });
    if (job) {
      job.pathA = true;
      job.starting = starting;
    }
    const http = await starting;
    if (http < 200 || http >= 300) return "failed";
    let transient = 0;
    for (;;) {
      await sleep(FETCH_POLL_MS, signal);
      const { http, job: status } = await this.deps.daemon.fetchStatus(trackId, signal);
      if (!status) {
        // Unreachable or starting daemon: keep polling a few times; 404 or any other error means the job is gone.
        transient = http === 0 || http === 503 ? transient + 1 : FETCH_TRANSIENT_LIMIT;
        if (transient >= FETCH_TRANSIENT_LIMIT) return "failed";
        continue;
      }
      transient = 0;
      if (status.state === "failed") return status.code === "unavailable" ? "unavailable" : "failed";
      if (status.state === "done") return "done";
    }
  }

  private async pathB(trackId: string, blob: Blob, resolved: Resolved, epoch: number): Promise<boolean> {
    this.heldBlob = blob;
    try {
      if (epoch !== this.epoch) return false;
      if (!(await checkCacheWrite(blob, resolved.source.mime))) return false;
      if (epoch !== this.epoch) return false;
      const status = await this.deps.daemon.putCache(trackId, blob, resolved.source.mime, resolved.stream.codec, resolved.stream.bitrateKbps);
      if (status < 200 || status >= 300 || epoch !== this.epoch) return false;
      this.deps.markCached(trackId);
      return true;
    } finally {
      this.heldBlob = null;
    }
  }

  private async idlePrefetch(): Promise<void> {
    const controller = new AbortController();
    this.idle = controller;
    try {
      while (!controller.signal.aborted) {
        const failedRecently = [...this.failedAt.entries()].filter(([, at]) => this.deps.now() - at < FAILED_RETRY_MS).map(([id]) => id);
        const missing = await this.deps.daemon.missingKept(failedRecently.length + 1);
        const track = missing.find((t) => !failedRecently.includes(t.id));
        if (!track || controller.signal.aborted) return;
        try {
          const resolved = await this.deps.resolve(track, { positionMs: 0, bypassCache: true, bestQuality: false, signal: controller.signal });
          try {
            await this.store(track, resolved, controller.signal);
          } finally {
            resolved.source.release();
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          this.deps.log("idle prefetch failed", error);
        }
        if (!(await this.deps.isCached(track.id))) this.failedAt.set(track.id, this.deps.now());
      }
    } finally {
      if (this.idle === controller) this.idle = null;
    }
  }
}
