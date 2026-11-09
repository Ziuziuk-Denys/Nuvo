import { idKind, primarySource, type Cause, type FallbackInfo, type SourceKind, type StreamInfo, type Track } from "../types";
import {
  alternativeStart,
  betterFormat,
  cacheGoodEnough,
  displayCause,
  FallbackBudget,
  isFallbackTrigger,
  isLastingReason,
  kbpsOf,
  type TriggerCause,
} from "./fallbackPlan";
import {
  isAbort,
  SourceFailure,
  youtubeCause,
  type Alternative,
  type CacheProbe,
  type DaemonPort,
  type MatchPort,
  type PlayableSource,
  type YoutubePort,
} from "./ports";

export const PROBE_HEAD_START_MS = 150;
export const SOURCE_DOWN_AFTER = 2;
export const SOURCE_DOWN_MS = 2 * 60_000;

export interface AttachedSource {
  trackId: string;
  kind: "cache" | "url" | "object" | "progressive";
  url: string;
  mime: string;
  expiresAt?: number;
  bytes?: Blob;
  whole?: Promise<Blob>;
  overflowed?: () => boolean;
  release(): void;
}

export interface Resolved {
  source: AttachedSource;
  stream: StreamInfo;
  fallback: FallbackInfo | null;
  startAtMs: number;
  fetchable?: { url: string; mime: string; codec: string; bitrateKbps: number; contentLength?: number };
  remember?: Alternative;
  altId?: string;
  altDurationMs?: number;
  altScore?: number;
  client?: string;
  wholeFile?: (signal: AbortSignal) => Promise<Blob>;
  verify?: () => Promise<Resolved>;
}

export interface ResolverDeps {
  daemon: DaemonPort;
  youtube: YoutubePort;
  match: MatchPort;
  now(): number;
  online(): boolean;
  offerSignIn(): boolean;
  objectUrls: { create(blob: Blob): string; revoke(url: string): void };
}

export interface ResolveOptions {
  positionMs: number;
  bypassCache: boolean;
  bestQuality: boolean;
  signal: AbortSignal;
  failedAlts?: ReadonlySet<string>;
  failedClients?: readonly string[];
  early?: boolean;
}

const noop = () => undefined;

function headStart(ms: number, signal: AbortSignal): { promise: Promise<null>; cancel(): void } {
  let cancel = noop;
  const promise = new Promise<null>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(null);
    }, ms);
    cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, cancel: () => cancel() };
}

function childSignal(parent: AbortSignal, timeoutMs?: number): { signal: AbortSignal; abort(): void } {
  const controller = new AbortController();
  const signals = [parent, controller.signal];
  if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(Math.max(1, timeoutMs)));
  return { signal: AbortSignal.any(signals), abort: () => controller.abort() };
}

export class SourceResolver {
  private readonly cached = new Map<string, CacheProbe>();
  private readonly rejected = new Map<string, Set<string>>();
  private blockedStarts = 0;
  private youtubeDownUntil = 0;

  constructor(private readonly deps: ResolverDeps) {}

  markCached(trackId: string, probe: CacheProbe = { codec: null, bitrateKbps: null }): void {
    this.cached.set(trackId, probe);
  }

  forgetCached(trackId?: string): void {
    if (trackId) this.cached.delete(trackId);
    else this.cached.clear();
  }

  isKnownCached(trackId: string): boolean {
    return this.cached.has(trackId);
  }

  async reject(trackId: string, altId?: string): Promise<void> {
    const id = altId ?? (await this.deps.daemon.getAlternative(trackId))?.altId;
    if (!id) return;
    const set = this.rejected.get(trackId) ?? new Set<string>();
    set.add(id);
    this.rejected.set(trackId, set);
    await this.deps.daemon.rejectAlternative(trackId, id);
  }

  async choose(trackId: string, alternative: Omit<Alternative, "reason">): Promise<void> {
    this.rejected.get(trackId)?.delete(alternative.altId);
    await this.deps.daemon.putAlternative(trackId, { ...alternative, reason: "pinned" });
  }

  async pin(track: Track, resolved: Resolved): Promise<boolean> {
    const source = resolved.stream.source;
    if (!resolved.altId || (source !== "youtube" && source !== "soundcloud")) return false;
    await this.deps.daemon.putAlternative(track.id, {
      source,
      altId: resolved.altId,
      score: resolved.altScore ?? 100,
      reason: "pinned",
      durationMs: resolved.altDurationMs,
    });
    return true;
  }

  async dropCached(trackId: string): Promise<void> {
    this.cached.delete(trackId);
    await this.deps.daemon.deleteCache(trackId);
  }

  networkChanged(): void {
    this.blockedStarts = 0;
    this.youtubeDownUntil = 0;
  }

  private noteBlocked(cause: TriggerCause): void {
    if (cause !== "blocked" && cause !== "timeout" && cause !== "stall" && cause !== "http_403") return;
    this.blockedStarts += 1;
    if (this.blockedStarts >= SOURCE_DOWN_AFTER) this.youtubeDownUntil = this.deps.now() + SOURCE_DOWN_MS;
  }

  async confirm(track: Track, resolved: Resolved): Promise<void> {
    if (resolved.stream.source === "youtube") this.networkChanged();
    if (resolved.remember) await this.deps.daemon.putAlternative(track.id, resolved.remember);
  }

  async resolve(track: Track, options: ResolveOptions): Promise<Resolved> {
    if (idKind(track.id) === "local") return this.local(track, options);
    if (options.bypassCache) return this.network(track, options);
    const known = this.cached.get(track.id);
    const probe = known ? Promise.resolve(known) : this.probe(track.id, options.signal);
    const wait = headStart(PROBE_HEAD_START_MS, options.signal);
    let quick: { hit: CacheProbe | null } | null;
    try {
      quick = await Promise.race([probe.then((hit) => ({ hit })), wait.promise]);
    } finally {
      wait.cancel();
    }
    if (quick) return quick.hit ? this.fromCacheOrBetter(track, quick.hit, options) : this.network(track, options);

    const net = childSignal(options.signal);
    const networkRun = this.network(track, { ...options, signal: net.signal }).then(
      (resolved) => ({ ok: true as const, resolved }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const first = await Promise.race([probe.then((hit) => ({ probe: hit })), networkRun.then((run) => ({ run }))]);
    if ("probe" in first) {
      if (first.probe) {
        if (this.needsNetworkCompare(first.probe, options)) {
          return this.fromCacheOrBetter(track, first.probe, options, async () => {
            const run = await networkRun;
            if (!run.ok) throw run.error;
            return run.resolved;
          });
        }
        net.abort();
        void networkRun.then((run) => run.ok && run.resolved.source.release());
        return this.fromCache(track, first.probe, null);
      }
      const run = await networkRun;
      if (run.ok) return run.resolved;
      throw run.error;
    }
    if (first.run.ok) return first.run.resolved;
    const late = await probe;
    if (late) return this.fromCache(track, late, null);
    throw first.run.error;
  }

  fallback(track: Track, cause: TriggerCause, failedSource: SourceKind, options: Omit<ResolveOptions, "bypassCache">): Promise<Resolved> {
    const tried = new Set<string>(options.failedAlts);
    if (failedSource === "youtube") this.noteBlocked(cause);
    return this.runFallback(track, cause, failedSource, new FallbackBudget(this.deps.now), tried, { ...options, bypassCache: false }, true);
  }

  private async probe(trackId: string, signal: AbortSignal): Promise<CacheProbe | null> {
    const hit = await this.deps.daemon.probeCache(trackId, signal);
    if (hit) this.cached.set(trackId, hit);
    return hit;
  }

  private fromCache(track: Track, probe: CacheProbe, fallback: FallbackInfo | null, startAtMs = 0): Resolved {
    return {
      source: { trackId: track.id, kind: "cache", url: this.deps.daemon.cacheUrl(track.id), mime: "audio/*", release: noop },
      stream: { source: "cache", codec: probe.codec ?? "", bitrateKbps: probe.bitrateKbps ?? 0, fromCache: true },
      fallback,
      startAtMs,
    };
  }

  private needsNetworkCompare(probe: CacheProbe, options: ResolveOptions): boolean {
    return options.bestQuality && probe.bitrateKbps !== null;
  }

  private async fromCacheOrBetter(
    track: Track,
    probe: CacheProbe,
    options: ResolveOptions,
    getNetwork: () => Promise<Resolved> = () => this.network(track, options),
  ): Promise<Resolved> {
    if (!this.needsNetworkCompare(probe, options)) return this.fromCache(track, probe, null);
    try {
      const network = await getNetwork();
      if (!cacheGoodEnough(probe.bitrateKbps, network.stream.bitrateKbps)) return network;
      network.source.release();
    } catch (error) {
      if (isAbort(error)) throw error;
    }
    return this.fromCache(track, probe, null);
  }

  private async network(track: Track, options: ResolveOptions): Promise<Resolved> {
    if (!this.deps.online()) throw new SourceFailure("offline");
    const remembered = await this.remembered(track.id);
    const tried = new Set<string>();
    // The 15 s and two-alternative budget starts with the first alternative, not with the primary resolve.
    let budget: FallbackBudget | null = null;
    if (remembered && isLastingReason(remembered.reason, options.bestQuality)) {
      tried.add(remembered.altId);
      budget = new FallbackBudget(this.deps.now);
      budget.spend();
      const limit = childSignal(options.signal, budget.msLeft).signal;
      try {
        return await this.viaAlternative(track, remembered, remembered.reason as TriggerCause, { ...options, signal: limit }, false);
      } catch (error) {
        if (options.signal.aborted) throw error;
      }
    }
    if (this.primaryKind(track) === "youtube" && this.deps.now() < this.youtubeDownUntil) {
      try {
        return await this.runFallback(track, "blocked", "youtube", budget ?? new FallbackBudget(this.deps.now), tried, options, false);
      } catch (error) {
        if (options.signal.aborted) throw error;
      }
    }
    try {
      const primary = await this.primary(track, options);
      return options.bestQuality ? await this.bestOf(track, primary, remembered, options) : primary;
    } catch (error) {
      if (isAbort(error)) throw error;
      const failure = error instanceof SourceFailure ? error : youtubeCause(error, this.deps.online());
      if (failure.detail.botCheck && this.deps.offerSignIn()) throw new SourceFailure("sign_in_required", { botCheck: true, signIn: true });
      if (!isFallbackTrigger(failure.cause)) throw failure;
      if (this.primaryKind(track) === "youtube") this.noteBlocked(failure.cause);
      return this.runFallback(track, failure.cause, this.primaryKind(track), budget ?? new FallbackBudget(this.deps.now), tried, options, false);
    }
  }

  private primaryKind(track: Track): SourceKind {
    return primarySource(track.id);
  }

  private async local(track: Track, options: ResolveOptions): Promise<Resolved> {
    const answer = await this.deps.daemon.probeLocal(track.id, options.signal);
    if (answer.ok) {
      return {
        source: { trackId: track.id, kind: "url", url: this.deps.daemon.localUrl(track.id), mime: answer.probe.mime, release: noop },
        stream: { source: "local", codec: answer.probe.codec, bitrateKbps: answer.probe.bitrateKbps ?? 0, fromCache: false },
        fallback: null,
        startAtMs: 0,
      };
    }
    const cause: TriggerCause = answer.status === 415 ? "media_error" : "unavailable";
    return this.runFallback(track, cause, "local", new FallbackBudget(this.deps.now), new Set(), options, false);
  }

  private async remembered(trackId: string): Promise<Alternative | null> {
    const alternative = await this.deps.daemon.getAlternative(trackId);
    if (!alternative || this.rejected.get(trackId)?.has(alternative.altId)) return null;
    return alternative;
  }

  private async primary(track: Track, options: ResolveOptions): Promise<Resolved> {
    const kind = idKind(track.id);
    if (kind === "soundcloud") return this.soundcloud(track, track.id, options.signal);
    const early = options.early === true && !options.bestQuality;
    const quality = options.bestQuality ? "hifi" : "normal";
    if (kind === "youtube") return this.youtube(track, track, options.signal, early, quality);
    const match = await this.deps.match.approvedOn("youtube", track, options.signal);
    if (!match) throw new SourceFailure("unavailable");
    return this.youtube(track, match.track, options.signal, early, quality);
  }

  private async youtube(track: Track, target: Track, signal: AbortSignal, early = false, quality: "normal" | "hifi" = "normal"): Promise<Resolved> {
    let playable: PlayableSource;
    try {
      playable = await this.deps.youtube.resolve(target, { progressive: true, early, quality }, signal);
    } catch (error) {
      if (isAbort(error)) throw error;
      throw youtubeCause(error, this.deps.online());
    }
    return this.attachPlayable(track, playable, "youtube");
  }

  private attachPlayable(track: Track, playable: PlayableSource, source: SourceKind): Resolved {
    const stream: StreamInfo = { source, codec: playable.codec, bitrateKbps: kbpsOf(playable.bitrate), fromCache: false };
    const base = { trackId: track.id, mime: playable.mimeType };
    const client = playable.servedBy;
    if (playable.bytes) {
      const url = this.deps.objectUrls.create(playable.bytes);
      return {
        source: { ...base, kind: "object", url, bytes: playable.bytes, release: () => this.deps.objectUrls.revoke(url) },
        stream,
        client,
        fallback: null,
        startAtMs: 0,
      };
    }
    if (playable.progressive) {
      const progressive = playable.progressive;
      return {
        source: {
          ...base,
          kind: "progressive",
          url: progressive.url,
          whole: progressive.whole,
          overflowed: () => progressive.overflowed(),
          release: () => progressive.release(),
        },
        stream,
        client,
        fallback: null,
        startAtMs: 0,
      };
    }
    if (!playable.url) throw new SourceFailure("unavailable");
    const verifyPlayable = playable.verify;
    const verify = verifyPlayable
      ? () =>
          verifyPlayable().then(
            (final) => this.attachPlayable(track, final, source),
            (error: unknown) => {
              throw isAbort(error) ? error : youtubeCause(error, this.deps.online());
            },
          )
      : undefined;
    return {
      verify,
      source: { ...base, kind: "url", url: playable.url, expiresAt: playable.expiresAt, release: noop },
      stream,
      client,
      fallback: null,
      startAtMs: 0,
      fetchable: {
        url: playable.url,
        mime: playable.mimeType,
        codec: playable.codec,
        bitrateKbps: kbpsOf(playable.bitrate),
        contentLength: playable.sizeBytes,
      },
      wholeFile: source === "youtube" ? (signal) => this.deps.youtube.fetchWhole(playable, signal) : undefined,
    };
  }

  private async soundcloud(track: Track, id: string, signal: AbortSignal): Promise<Resolved> {
    const descriptor = await this.deps.daemon.scStream(id.replace(/^sc:/, ""), signal);
    const kbps = kbpsOf(descriptor.bitrate);
    const stream: StreamInfo = { source: "soundcloud", codec: descriptor.codec, bitrateKbps: kbps, fromCache: false };
    return {
      source: {
        trackId: track.id,
        kind: "url",
        url: descriptor.url,
        mime: descriptor.mimeType,
        expiresAt: descriptor.expiresAt ?? undefined,
        release: noop,
      },
      stream,
      fallback: null,
      startAtMs: 0,
      fetchable:
        descriptor.kind === "direct"
          ? { url: descriptor.url, mime: descriptor.mimeType, codec: descriptor.codec, bitrateKbps: kbps, contentLength: descriptor.contentLength ?? undefined }
          : undefined,
    };
  }

  private async bestOf(track: Track, primary: Resolved, remembered: Alternative | null, options: ResolveOptions): Promise<Resolved> {
    const other: "youtube" | "soundcloud" = this.primaryKind(track) === "youtube" ? "soundcloud" : "youtube";
    let alternative = remembered;
    if (!alternative) {
      const match = await this.deps.match.approvedOn(other, track, options.signal, this.rejected.get(track.id)).catch(() => null);
      if (match) {
        alternative = { source: other, altId: match.track.id, score: match.score, reason: "bitrate", durationMs: match.track.durationMs };
      }
    }
    if (!alternative) return primary;
    try {
      const candidate = await this.viaAlternative(track, alternative, "unavailable", options, alternative !== remembered, "bitrate");
      if (betterFormat(candidate.stream, primary.stream)) {
        primary.source.release();
        return candidate;
      }
      candidate.source.release();
    } catch (error) {
      if (isAbort(error)) throw error;
    }
    return primary;
  }

  private async viaAlternative(
    track: Track,
    alternative: Alternative,
    cause: TriggerCause,
    options: ResolveOptions,
    isNew: boolean,
    reason: string = cause,
  ): Promise<Resolved> {
    const altTrack: Track = { ...track, id: alternative.altId, durationMs: alternative.durationMs ?? track.durationMs };
    const resolved =
      alternative.source === "soundcloud"
        ? await this.soundcloud(track, alternative.altId, options.signal)
        : await this.youtube(track, altTrack, options.signal, false, options.bestQuality ? "hifi" : "normal");
    const start =
      alternative.durationMs === undefined
        ? { startAtMs: 0, restarted: options.positionMs > 0 }
        : alternativeStart(options.positionMs, track.durationMs, alternative.durationMs);
    return {
      ...resolved,
      startAtMs: start.startAtMs,
      fallback:
        reason === "bitrate" || reason === "pinned"
          ? null
          : { primarySource: this.primaryKind(track), usedSource: alternative.source, cause, score: alternative.score, restarted: start.restarted },
      altId: alternative.altId,
      altDurationMs: alternative.durationMs,
      altScore: alternative.score,
      remember: isNew
        ? { source: alternative.source, altId: alternative.altId, score: alternative.score, reason, durationMs: alternative.durationMs }
        : undefined,
    };
  }

  private async runFallback(
    track: Track,
    cause: TriggerCause,
    failedSource: SourceKind,
    budget: FallbackBudget,
    tried: Set<string>,
    options: ResolveOptions,
    probeCache: boolean,
  ): Promise<Resolved> {
    const step = <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => run(childSignal(options.signal, budget.msLeft).signal);

    if (probeCache && failedSource !== "cache" && idKind(track.id) !== "local" && !options.bypassCache) {
      const hit = this.cached.get(track.id) ?? (await this.probe(track.id, options.signal));
      if (hit) return this.fromCache(track, hit, null, options.positionMs);
    }
    // Another YouTube client beats any match: a failed client means the URL is bad, not the video
    if (failedSource === "youtube" && options.failedClients?.length && idKind(track.id) === "youtube" && !budget.exhausted) {
      try {
        return await step((signal) => this.otherClient(track, options, signal));
      } catch (error) {
        if (options.signal.aborted) throw error;
      }
    }
    const remembered = await this.remembered(track.id);
    if (remembered && !tried.has(remembered.altId) && !budget.exhausted) {
      tried.add(remembered.altId);
      budget.spend();
      try {
        return await step((signal) => this.viaAlternative(track, remembered, cause, { ...options, signal }, false));
      } catch (error) {
        if (options.signal.aborted) throw error;
      }
    }
    const other: "youtube" | "soundcloud" = this.primaryKind(track) === "youtube" ? "soundcloud" : "youtube";
    tried.add(track.id);
    while (!budget.exhausted) {
      budget.spend();
      try {
        const exclude = new Set([...tried, ...(this.rejected.get(track.id) ?? [])]);
        const match = await step((signal) => this.deps.match.approvedOn(other, track, signal, exclude));
        if (!match || exclude.has(match.track.id)) break;
        tried.add(match.track.id);
        const alternative: Alternative = { source: other, altId: match.track.id, score: match.score, reason: cause, durationMs: match.track.durationMs };
        return await step((signal) => this.viaAlternative(track, alternative, cause, { ...options, signal }, true));
      } catch (error) {
        if (options.signal.aborted) throw error;
      }
    }
    const display: Cause = displayCause(cause);
    throw new SourceFailure(display, display === cause ? {} : { original: cause });
  }

  private async otherClient(track: Track, options: ResolveOptions, signal: AbortSignal): Promise<Resolved> {
    let playable: PlayableSource;
    try {
      const quality = options.bestQuality ? "hifi" : "normal";
      playable = await this.deps.youtube.resolve(track, { progressive: true, quality, avoid: [...(options.failedClients ?? [])] }, signal);
    } catch (error) {
      if (isAbort(error)) throw error;
      throw youtubeCause(error, this.deps.online());
    }
    return { ...this.attachPlayable(track, playable, "youtube"), startAtMs: options.positionMs };
  }
}
