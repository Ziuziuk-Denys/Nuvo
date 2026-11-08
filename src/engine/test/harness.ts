/** Fakes for engine tests: one deck port, a daemon behind `fetch`, YouTube, matching and continuation ports. */
import { vi } from "vitest";
import type { ContinuationRequest, Suggested } from "../continuation";
import type { DeckCandidate, DeckEvent, DeckLoad, DeckPort } from "../deckPort";
import { Engine, type EngineDeps } from "../engine";
import type { KeyValue } from "../persist";
import type { PlaybackEventBody } from "../playReport";
import { seededRandom } from "../shuffle";
import { createDaemonClient } from "../sources/daemon";
import type { MatchPort, PlayableSource, YoutubePort } from "../sources/ports";
import { SourceResolver } from "../sources/resolver";
import { PrecacheScheduler } from "../sources/precache";
import type { Tempo } from "../tempo";
import type { Track } from "../types";

export const BASE = "nuvo-core://local";

export function track(id: string, extra: Partial<Track> = {}): Track {
  return { id, title: `Title ${id}`, artists: `Artist ${id}`, coverUrl: "", durationMs: 200_000, ...extra };
}

/** 11-character YouTube-shaped ids: y("a") -> "aaaaaaaaaaa". */
export const y = (letter: string) => letter.repeat(11).slice(0, 11);

export class MemoryStorage implements KeyValue {
  readonly data = new Map<string, string>();
  quotaBytes = Infinity;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quotaBytes) throw new DOMException("quota", "QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

export class FakeDeck implements DeckPort {
  loads: DeckLoad[] = [];
  active: DeckLoad | null = null;
  attachedUrl: string | null = null;
  position = 0;
  duration = 0;
  error = false;
  /** Rejects the next `play()` (load or resume) with this DOMException name. */
  rejectNext: string | null = null;
  /** When false, load() does not emit `playing` by itself. */
  autoPlaying = true;
  /** The next load() never settles, like `element.play()` on a stream that never answers. */
  hangNext = false;
  candidate: DeckCandidate | null = null;
  candidates: Array<DeckCandidate | null> = [];
  prepared: string | null = null;
  volume = 1;
  tempo: Tempo | null = null;
  seeks: number[] = [];
  resets = 0;
  pauses = 0;
  private listeners = new Set<(event: DeckEvent) => void>();
  private switchListeners = new Set<(entryId: string) => void>();

  async load(load: DeckLoad): Promise<void> {
    this.loads.push(load);
    this.active?.source.release();
    this.active = load;
    this.attachedUrl = load.source.url;
    this.position = load.positionMs;
    this.error = false;
    this.tempo = load.tempo;
    await Promise.resolve();
    if (this.hangNext) {
      this.hangNext = false;
      return new Promise<void>(() => undefined);
    }
    if (this.rejectNext) {
      const name = this.rejectNext;
      this.rejectNext = null;
      throw new DOMException(name, name);
    }
    if (this.autoPlaying && this.active === load) this.emit("playing");
  }
  async pause() {
    this.pauses += 1;
  }
  async resume() {
    await Promise.resolve();
    if (this.rejectNext) {
      const name = this.rejectNext;
      this.rejectNext = null;
      throw new DOMException(name, name);
    }
    this.emit("playing");
  }
  seek(positionMs: number) {
    this.seeks.push(positionMs);
    this.position = positionMs;
  }
  disposed = 0;
  dispose() {
    this.disposed += 1;
  }
  reset() {
    this.resets += 1;
    this.active?.source.release();
    this.active = null;
    this.attachedUrl = null;
  }
  holds(token: number) {
    return this.active?.token === token && !this.error;
  }
  hasError() {
    return this.error;
  }
  audioTime() {
    return null;
  }

  positionMs() {
    return this.position;
  }
  setVolume(gain: number) {
    this.volume = gain;
  }
  setTempo(tempo: Tempo) {
    this.tempo = tempo;
  }
  reverb: { on: boolean; level: number } | null = null;
  setReverb(on: boolean, level: number) {
    this.reverb = { on, level };
  }
  swapSource(token: number, source: DeckLoad["source"]) {
    if (this.active?.token !== token) return;
    this.active = { ...this.active, source };
    this.attachedUrl = source.url;
  }
  setCandidate(candidate: DeckCandidate | null) {
    this.candidate = candidate;
    this.candidates.push(candidate);
  }
  switchNow(entryId: string) {
    return this.prepared === entryId;
  }
  on(listener: (event: DeckEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onSwitch(listener: (entryId: string) => void) {
    this.switchListeners.add(listener);
    return () => this.switchListeners.delete(listener);
  }
  claim(token: number) {
    if (this.active) this.active = { ...this.active, token };
  }
  /** The prepared deck takes over by itself. */
  fireSwitch(entryId: string, token: number) {
    for (const listener of this.switchListeners) listener(entryId);
    void token;
  }
  emit(type: DeckEvent["type"], extra: Partial<DeckEvent> = {}) {
    if (!this.active) return;
    if (type === "timeupdate" && extra.positionMs !== undefined) this.position = extra.positionMs;
    if (type === "error") this.error = true;
    const event: DeckEvent = {
      type,
      token: this.active.token,
      positionMs: this.position,
      durationMs: this.duration,
      enoughData: true,
      ...extra,
    };
    for (const listener of [...this.listeners]) listener(event);
  }
}

type Handler = (request: Request, url: URL) => Response | Promise<Response>;

/** Daemon behind `fetch`, keyed by "METHOD /path". An unmatched request throws, failing the test. */
export class FakeDaemon {
  readonly calls: Array<{ method: string; path: string; body: string | null; headers: Headers }> = [];
  private readonly routes = new Map<string, Handler>();

  constructor() {
    this.on("POST /v1/me/playback/events", () => new Response(null, { status: 204 }));
    this.onPrefix("GET /v1/cache/audio/", () => new Response(null, { status: 404 }));
    this.onPrefix("GET /v1/tracks/", () => new Response(null, { status: 404 }));
    this.onPrefix("PUT /v1/tracks/", () => new Response(null, { status: 204 }));
    this.onPrefix("POST /v1/tracks/", () => new Response(null, { status: 204 }));
    this.on("POST /v1/cache/fetch", () => new Response(null, { status: 202 }));
    this.onPrefix("DELETE /v1/cache/", () => new Response(null, { status: 204 }));
    this.onPrefix("PUT /v1/cache/audio/", () => new Response(null, { status: 201 }));
  }

  private readonly prefixes: Array<[string, Handler]> = [];

  on(key: string, handler: Handler): this {
    this.routes.set(key, handler);
    return this;
  }

  onPrefix(prefix: string, handler: Handler): this {
    this.prefixes.unshift([prefix, handler]);
    return this;
  }

  cached(trackId: string, headers: Record<string, string> = {}): this {
    return this.on(
      `GET /v1/cache/audio/${trackId}`,
      () => new Response(new Uint8Array([1]), { status: 206, headers: { "content-range": "bytes 0-0/1000", ...headers } }),
    );
  }

  fetch: typeof fetch = async (input, init) => {
    const request = new Request(input as string, init);
    const url = new URL(request.url.replace("nuvo-core://local", "http://core.local"));
    const method = request.method.toUpperCase();
    const key = `${method} ${url.pathname}`;
    const body = init?.body instanceof Blob ? `blob:${init.body.size}` : typeof init?.body === "string" ? init.body : null;
    this.calls.push({ method, path: url.pathname + url.search, body, headers: request.headers });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const exact = this.routes.get(key);
    if (exact) return exact(request, url);
    const prefix = this.prefixes.find(([p]) => key.startsWith(p));
    if (prefix) return prefix[1](request, url);
    throw new Error(`unexpected daemon request ${key}`);
  };

  callsTo(method: string, pathStart: string) {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathStart));
  }
}

export class FakeYoutube implements YoutubePort {
  readonly resolves: string[] = [];
  readonly early: boolean[] = [];
  readonly avoided: string[][] = [];
  readonly script = new Map<string, (signal: AbortSignal) => Promise<PlayableSource>>();
  warmUps = 0;

  resolve(target: Track, options: { progressive: boolean; early?: boolean; avoid?: string[] }, signal: AbortSignal): Promise<PlayableSource> {
    this.resolves.push(target.id);
    this.early.push(options.early === true);
    this.avoided.push(options.avoid ?? []);
    const scripted = this.script.get(target.id);
    if (scripted) return scripted(signal);
    // One client by default: asking around it finds nothing.
    if (options.avoid?.length) return Promise.reject({ code: "all-failed" });
    return Promise.resolve(urlSource(`https://rr1.googlevideo.com/${target.id}`));
  }
  fetchWhole(source: PlayableSource): Promise<Blob> {
    return Promise.resolve(source.bytes ?? new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]));
  }
  warmUp() {
    this.warmUps += 1;
  }
  fail(id: string, code: string, extra: Record<string, unknown> = {}) {
    this.script.set(id, () => Promise.reject({ code, ...extra }));
  }
  pending(id: string) {
    let resolve!: (source: PlayableSource) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<PlayableSource>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // An aborted start may never call the script; its late rejection is then expected.
    promise.catch(() => undefined);
    this.script.set(
      id,
      (signal) =>
        new Promise((res, rej) => {
          promise.then(res, rej);
          signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
    );
    return { resolve: (source: PlayableSource) => resolve(source), reject: (error: unknown) => reject(error) };
  }
}

export function urlSource(url: string, extra: Partial<PlayableSource> = {}): PlayableSource {
  return { url, mimeType: "audio/webm", codec: "opus", bitrate: 160_000, expiresAt: Date.now() + 6 * 3600_000, servedBy: "WEB_REMIX", ...extra };
}

export class FakeMatch implements MatchPort {
  readonly calls: Array<{ target: string; id: string; exclude: string[] }> = [];
  answers: Array<{ track: Track; score: number } | null> = [];
  async approvedOn(target: "youtube" | "soundcloud", t: Track, _signal: AbortSignal, exclude?: ReadonlySet<string>) {
    this.calls.push({ target, id: t.id, exclude: [...(exclude ?? [])] });
    const answer = this.answers.find((a) => !a || !exclude?.has(a.track.id));
    return answer ?? null;
  }
}

export class FakeContinuation {
  readonly requests: ContinuationRequest[] = [];
  answers: Array<Suggested[] | Error> = [];
  pendingResolve: ((tracks: Suggested[]) => void) | null = null;
  hold = false;
  next = (request: ContinuationRequest): Promise<Suggested[]> => {
    this.requests.push(request);
    if (this.hold) return new Promise((resolve) => (this.pendingResolve = resolve));
    const answer = this.answers.shift() ?? [];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
}

export interface Harness {
  engine: Engine;
  deck: FakeDeck;
  daemon: FakeDaemon;
  youtube: FakeYoutube;
  match: FakeMatch;
  continuation: FakeContinuation;
  storage: MemoryStorage;
  reports: PlaybackEventBody[];
  notices: string[];
  checks: string[];
  signIns: number;
  lyrics: Array<{ kind: "follow" | "prefetch"; id: string | null }>;
  warmed: string[];
  deps: EngineDeps;
  resolver: SourceResolver;
  precache: PrecacheScheduler | null;
}

export interface HarnessOptions {
  storage?: MemoryStorage;
  offerSignIn?: boolean;
  online?: boolean;
  slowReport?: Promise<void>;
  seed?: number;
  precache?: boolean;
}

let ids = 0;

export function createHarness(options: HarnessOptions = {}): Harness {
  const deck = new FakeDeck();
  const daemon = new FakeDaemon();
  const youtube = new FakeYoutube();
  const match = new FakeMatch();
  const continuation = new FakeContinuation();
  const storage = options.storage ?? new MemoryStorage();
  const reports: PlaybackEventBody[] = [];
  const notices: string[] = [];
  const checks: string[] = [];
  const lyrics: Harness["lyrics"] = [];
  const warmed: string[] = [];
  const client = createDaemonClient(BASE, daemon.fetch);
  const resolver = new SourceResolver({
    daemon: client,
    youtube,
    match,
    now: () => Date.now(),
    online: () => options.online ?? true,
    offerSignIn: () => options.offerSignIn ?? false,
    objectUrls: { create: (blob) => `blob:nuvo/${blob.size}-${++ids}`, revoke: () => undefined },
  });
  const harness = { signIns: 0 } as Harness;
  const precache = options.precache
    ? new PrecacheScheduler({
        daemon: client,
        resolve: (t, o) => resolver.resolve(t, o),
        isCached: async (id) => resolver.isKnownCached(id) || (await client.probeCache(id)) !== null,
        markCached: (id) => resolver.markCached(id),
        now: () => Date.now(),
        log: () => undefined,
      })
    : null;
  const deps: EngineDeps = {
    decks: deck,
    resolver,
    continuation,
    postReport: async (body) => {
      reports.push(body);
      if (options.slowReport) await options.slowReport;
    },
    storage,
    now: () => Date.now(),
    random: seededRandom(options.seed ?? 42),
    newId: () => `e${++ids}`,
    notify: (notice) => notices.push(notice.text),
    askForSignIn: () => {
      harness.signIns += 1;
    },
    network: { checkSoon: (cause) => checks.push(cause) },
    online: () => options.online ?? true,
    lyrics: {
      follow: (t) => lyrics.push({ kind: "follow", id: t?.id ?? null }),
      prefetch: (t) => lyrics.push({ kind: "prefetch", id: t.id }),
    },
    covers: { warm: (url) => warmed.push(url) },
    precache: precache ?? undefined,
    log: vi.fn(),
  };
  const engine = new Engine(deps);
  return Object.assign(harness, {
    engine,
    deck,
    daemon,
    youtube,
    match,
    continuation,
    storage,
    reports,
    notices,
    checks,
    lyrics,
    warmed,
    deps,
    resolver,
    precache,
  });
}

/** Lets resolved promises and their continuations run (fake timers do not cover microtasks). */
export async function flush(rounds = 100): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Advances fake timers and flushes microtasks in between, so timer-started promise chains complete. */
export async function advance(ms: number, step = 50): Promise<void> {
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(step, left);
    await vi.advanceTimersByTimeAsync(chunk);
    left -= chunk;
  }
  await flush();
}
