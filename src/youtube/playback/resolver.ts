import { ANDROID_VR, TVHTML5, VISIONOS, WEB_REMIX, type ClientContext } from "../constants";
import { YtError, isAbortError, throwIfAborted, type YtAttempt } from "../types";
import { fallbackAttempt, webRemixAttempt, type PlaybackDeps, type StreamHit } from "./attempts";
import { probe } from "./player";
import { raceAbort } from "./worker";
import { report, validUntilMs, type CodecPreference, type Quality } from "./formats";

type Choice = { quality: Quality; codec?: CodecPreference };

export interface ResolveOptions {
  progressive: boolean;
  early?: boolean;
  quality?: Quality;
  codec?: CodecPreference;
  avoid?: string[];
}

export interface YtSource {
  url?: string;
  expiresAt?: number;
  progressive?: {
    url: string;
    whole: Promise<Blob>;
    overflowed(): boolean;
    release(): void;
  };
  bytes?: Blob;
  mimeType: string;
  codec: string;
  bitrate: number;
  sizeBytes?: number;
  sampleRate?: number;
  channels?: number;
  loudnessDb?: number;
  durationMs?: number;
  servedBy: string;
  itag?: number;
  // Start verify once the stream answered: googlevideo serves the two requests one after the other
  verify?: () => Promise<YtSource>;
}

export interface SignedInStep {
  enabled(): boolean;
  resolve(videoId: string, options: ResolveOptions, signal: AbortSignal): Promise<YtSource>;
}

export const WEB_REMIX_ATTEMPTS = 2;
export const COOLDOWN_AFTER = 3;
export const COOLDOWN_MS = 5 * 60 * 1000;
export const CLIENT_BUDGET_MS = 3000;
export const HEDGE_MS = 1000;
const MAX_LANES = 2;
const FALLBACKS: ClientContext[] = [TVHTML5, VISIONOS, ANDROID_VR];

const PER_TRACK_LIMIT = 200;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function videoIdOf(trackId: string): string | undefined {
  const bare = trackId.startsWith("yt:") ? trackId.slice(3) : trackId;
  return VIDEO_ID.test(bare) ? bare : undefined;
}

const describe = (error: unknown) => {
  const yt = error instanceof YtError ? error : undefined;
  return {
    code: yt?.code ?? "error",
    text: yt?.message ?? String((error as Error)?.message ?? error),
    ...(yt?.status ? { status: yt.status } : {}),
  };
};

export function toSource(hit: StreamHit): YtSource {
  const reported = report(hit.format);
  return {
    url: hit.url,
    expiresAt: validUntilMs(hit.url) ?? undefined,
    mimeType: reported.mimeType,
    codec: reported.codec,
    bitrate: reported.bitrate,
    sizeBytes: reported.sizeBytes,
    sampleRate: reported.sampleRate,
    channels: reported.channels,
    loudnessDb: hit.loudnessDb ?? reported.loudnessDb,
    durationMs: reported.durationMs,
    servedBy: hit.client,
    itag: reported.itag,
  };
}

export class StreamResolver {
  private failures = 0;
  private coolingUntil = 0;
  private lastWebRemixError = "";
  private down = new Map<string, string>();
  private lastGood: string | null = null;
  private perTrack = new Map<string, string>();
  private probedOk = new Set<string>();
  private warming = false;

  constructor(
    private readonly deps: PlaybackDeps & {
      signedIn?: SignedInStep;
      log?: (message: string) => void;
    },
    private readonly attempts = {
      webRemix: webRemixAttempt,
      fallback: fallbackAttempt,
    },
  ) {}

  reset(): void {
    this.failures = 0;
    this.coolingUntil = 0;
    this.down.clear();
    this.lastGood = null;
    this.perTrack.clear();
    this.probedOk.clear();
    this.deps.player.reset();
  }

  private remember(videoId: string, client: string): void {
    this.perTrack.delete(videoId);
    this.perTrack.set(videoId, client);
    if (this.perTrack.size > PER_TRACK_LIMIT) this.perTrack.delete(this.perTrack.keys().next().value!);
  }

  async resolve(track: { id: string }, options: ResolveOptions, signal: AbortSignal): Promise<YtSource> {
    const videoId = videoIdOf(track.id);
    if (!videoId) throw new YtError("bad-id");
    throwIfAborted(signal);

    if (this.deps.signedIn?.enabled()) {
      try {
        return await this.deps.signedIn.resolve(videoId, options, signal);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error;
        this.deps.log?.(`[youtube] signed-in playback failed: ${describe(error).code}`);
      }
    }

    const cold = await this.workerCold(signal);
    // The warm-up waits until the stream answered (an early start's verify), so it does not compete with the first request.
    let warmed = !cold;
    const warmOnce = () => {
      if (warmed) return;
      warmed = true;
      this.warmWorker(videoId);
    };
    const chain = this.chain(videoId, options, signal, cold);
    try {
      let step = await chain.next();
      while (!step.done) {
        const hit = step.value;
        // A cold first track trusts VISIONOS before its probe: known good and needs no worker
        const trusted = this.probedOk.has(hit.client) || (cold && hit.client === VISIONOS.clientName);
        if (options.early && trusted) {
          let verified: Promise<YtSource> | null = null;
          const verify = () => {
            warmOnce();
            return (verified ??= this.finish(chain, hit, signal));
          };
          return { ...toSource(hit), verify };
        }
        step = await chain.next(await this.probeHit(hit, signal));
      }
      warmOnce();
      return step.value;
    } catch (error) {
      if (!isAbortError(error) && !signal.aborted) warmOnce();
      throw error;
    }
  }

  private async finish(chain: AsyncGenerator<StreamHit, YtSource, unknown>, hit: StreamHit, signal: AbortSignal): Promise<YtSource> {
    let step = await chain.next(await this.probeHit(hit, signal));
    while (!step.done) step = await chain.next(await this.probeHit(step.value, signal));
    return step.value;
  }

  private async withinBudget<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), CLIENT_BUDGET_MS);
    try {
      return await run(AbortSignal.any([signal, limit.signal]));
    } catch (error) {
      if (limit.signal.aborted && !signal.aborted) throw new YtError("worker-timeout", { text: "client timed out" });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeHit(hit: StreamHit, signal: AbortSignal): Promise<unknown> {
    try {
      await this.withinBudget((limited) => probe(this.deps.fetch, hit.url, Number(hit.format.contentLength) || undefined, limited), signal);
      this.probedOk.add(hit.client);
      return undefined;
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error;
      this.probedOk.delete(hit.client);
      return error ?? new YtError("rejected-stream");
    }
  }

  private async workerCold(signal: AbortSignal): Promise<boolean> {
    if (this.warming) return true;
    const isReady = this.deps.worker.isReady?.bind(this.deps.worker);
    if (!isReady) return false;
    try {
      return !(await raceAbort(isReady(), signal));
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error;
      return false;
    }
  }

  private warmWorker(videoId: string): void {
    if (this.warming) return;
    const done = () => {
      this.warming = false;
    };
    this.warming = true;
    void Promise.allSettled([this.deps.worker.contentToken(videoId), this.deps.player.signatureTimestamp(new AbortController().signal)]).then(done);
  }

  private markIfRefused(client: string, error: unknown): boolean {
    const { status, text } = describe(error);
    if (status !== 403) return false;
    this.down.set(client, text);
    return true;
  }

  private async attempt(name: string, videoId: string, choice: Choice, tries: { left: number }, signal: AbortSignal): Promise<StreamHit> {
    if (name !== WEB_REMIX.clientName) {
      const client = FALLBACKS.find((candidate) => candidate.clientName === name)!;
      try {
        return await this.withinBudget((limited) => this.attempts.fallback(this.deps, client, videoId, choice, limited), signal);
      } catch (error) {
        if (name === ANDROID_VR.clientName && !isAbortError(error) && !signal.aborted) this.markIfRefused(name, error);
        throw error;
      }
    }
    let lastError: unknown;
    while (tries.left > 0) {
      tries.left -= 1;
      try {
        return await this.withinBudget((limited) => this.attempts.webRemix(this.deps, videoId, choice, limited), signal);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error;
        lastError = error;
        if (this.final(name, error)) break;
      }
    }
    this.webRemixFailed(lastError);
    throw lastError;
  }

  // A refusal from the player endpoint, a bot check or a server limit will not change on a second ask
  private final(name: string, error: unknown): boolean {
    const code = describe(error).code;
    return code === "unplayable" || code === "bot-check" || this.markIfRefused(name, error);
  }

  private webRemixFailed(error: unknown): void {
    this.lastWebRemixError = describe(error).text;
    this.failures += 1;
    if (this.failures >= COOLDOWN_AFTER) {
      this.coolingUntil = Date.now() + COOLDOWN_MS;
      this.failures = 0;
    }
  }

  private succeeded(videoId: string, name: string): void {
    if (name === WEB_REMIX.clientName) this.failures = 0;
    else this.lastGood = name;
    this.remember(videoId, name);
  }

  // A client silent for a second rarely answers soon; two at most keep the player endpoint from rate-limiting the user
  private async *chain(videoId: string, options: ResolveOptions, signal: AbortSignal, cold: boolean): AsyncGenerator<StreamHit, YtSource, unknown> {
    const choice: Choice = {
      quality: options.quality ?? "normal",
      codec: options.codec,
    };
    const log: YtAttempt[] = [];
    const fail = (client: string, error: unknown) => {
      if (isAbortError(error) || signal.aborted) throw error;
      log.push({ client, ...describe(error) });
    };

    const remembered = this.perTrack.get(videoId);
    const order: string[] = [];
    // A cold worker: VISIONOS needs neither worker nor PO token, so it goes first while the worker warms up.
    if (cold) {
      order.push(VISIONOS.clientName);
    }
    if (remembered) order.push(remembered);
    order.push(WEB_REMIX.clientName);
    if (this.lastGood) order.push(this.lastGood);
    order.push(...FALLBACKS.map((client) => client.clientName));

    const names: string[] = [];
    for (const name of new Set(order)) {
      if (options.avoid?.includes(name)) continue;
      const paused = name === WEB_REMIX.clientName && Date.now() < this.coolingUntil;
      if (this.down.has(name) || paused) {
        log.push({ client: name, code: "paused", text: this.down.get(name) ?? this.lastWebRemixError });
        continue;
      }
      names.push(name);
    }

    type Lane = { id: number; name: string; hit?: StreamHit; error?: unknown };
    const running = new Map<number, Promise<Lane>>();
    const stops: AbortController[] = [];
    const webRemixTries = { left: WEB_REMIX_ATTEMPTS };
    let lanes = 0;
    const launch = (name = names.shift()) => {
      if (!name) return;
      const id = lanes++;
      const stop = new AbortController();
      stops.push(stop);
      const lane = this.attempt(name, videoId, choice, webRemixTries, AbortSignal.any([signal, stop.signal])).then(
        (hit) => ({ id, name, hit }),
        (error: unknown) => ({ id, name, error }),
      );
      running.set(id, lane);
    };
    try {
      launch();
      while (running.size > 0) {
        throwIfAborted(signal);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const hedge = names.length > 0 && running.size < MAX_LANES ? new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), HEDGE_MS))) : null;
        const lane = await Promise.race(hedge ? [...running.values(), hedge] : running.values()).finally(() => clearTimeout(timer));
        if (!lane) {
          launch();
          continue;
        }
        running.delete(lane.id);
        const name = lane.name;
        if (lane.hit) {
          const probeFailure = yield lane.hit;
          if (!probeFailure) {
            this.succeeded(videoId, name);
            return toSource(lane.hit);
          }
          if (name === ANDROID_VR.clientName) this.markIfRefused(name, probeFailure);
          if (name === WEB_REMIX.clientName) {
            if (!this.final(name, probeFailure) && webRemixTries.left > 0) {
              launch(name);
              continue;
            }
            this.webRemixFailed(probeFailure);
          }
          fail(name, probeFailure);
        } else {
          fail(name, lane.error);
        }
        if (running.size < MAX_LANES) launch();
      }
    } finally {
      for (const stop of stops) stop.abort();
    }

    const real = log.filter((entry) => entry.code !== "paused");
    const botCheck = real.length > 0 && real.every((entry) => entry.code === "bot-check");
    const status = Math.max(0, ...log.map((entry) => entry.status ?? 0));
    throw new YtError(botCheck ? "bot-check" : "all-failed", {
      attempts: log,
      botCheck,
      status: status || undefined,
      text: log.map((entry) => `${entry.client}: ${entry.code}`).join("; "),
    });
  }
}
