import { ANDROID_VR, TVHTML5, VISIONOS, WEB_REMIX, type ClientContext } from "../constants";
import { YtError, isAbortError, throwIfAborted, type YtAttempt } from "../types";
import { fallbackAttempt, webRemixAttempt, type PlaybackDeps, type StreamHit } from "./attempts";
import { probe } from "./player";
import { raceAbort } from "./worker";
import { report, validUntilMs, type CodecPreference, type Quality } from "./formats";

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

  private async *chain(videoId: string, options: ResolveOptions, signal: AbortSignal, cold: boolean): AsyncGenerator<StreamHit, YtSource, unknown> {
    const choice = {
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

    for (const name of new Set(order)) {
      throwIfAborted(signal);
      if (options.avoid?.includes(name)) continue;
      if (name === WEB_REMIX.clientName) {
        if (this.down.has(name) || Date.now() < this.coolingUntil) {
          log.push({
            client: name,
            code: "paused",
            text: this.down.get(name) ?? this.lastWebRemixError,
          });
          continue;
        }
        let lastError: unknown;
        for (let attempt = 0; attempt < WEB_REMIX_ATTEMPTS; attempt += 1) {
          try {
            const hit = await this.withinBudget((limited) => this.attempts.webRemix(this.deps, videoId, choice, limited), signal);
            const probeFailure = yield hit;
            if (probeFailure) throw probeFailure;
            this.failures = 0;
            this.remember(videoId, name);
            return toSource(hit);
          } catch (error) {
            if (isAbortError(error) || signal.aborted) throw error;
            lastError = error;
            // A refusal from the player endpoint will not change on a second ask.
            if (describe(error).code === "unplayable") break;
            if (describe(error).code === "bot-check") break;
            // A fresh token cannot lift a server limit either.
            if (this.markIfRefused(name, error)) break;
          }
        }
        this.lastWebRemixError = describe(lastError).text;
        this.failures += 1;
        if (this.failures >= COOLDOWN_AFTER) {
          this.coolingUntil = Date.now() + COOLDOWN_MS;
          this.failures = 0;
        }
        fail(name, lastError);
        continue;
      }
      if (this.down.has(name)) {
        log.push({ client: name, code: "paused", text: this.down.get(name)! });
        continue;
      }
      const client = FALLBACKS.find((candidate) => candidate.clientName === name)!;
      try {
        const hit = await this.withinBudget((limited) => this.attempts.fallback(this.deps, client, videoId, choice, limited), signal);
        const probeFailure = yield hit;
        if (probeFailure) throw probeFailure;
        this.lastGood = name;
        this.remember(videoId, name);
        return toSource(hit);
      } catch (error) {
        if (name === ANDROID_VR.clientName) this.markIfRefused(name, error);
        fail(name, error);
      }
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
