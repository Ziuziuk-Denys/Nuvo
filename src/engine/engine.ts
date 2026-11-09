import { BATCH_SIZE, MAX_SEED_IDS, Refill, type ContinuationPort, type ContinuationRequest, type Suggested } from "./continuation";
import type { DeckCandidate, DeckEvent, DeckPort } from "./deckPort";
import { MediaSessionMirror } from "./mediaSession";
import {
  loadPrefs,
  loadSession,
  migrateLegacy,
  savePrefs,
  savePosition,
  saveSession,
  SessionWriter,
  type KeyValue,
  type Prefs,
  type SavedSession,
} from "./persist";
import { PlayTracker, ReportOutbox, type PlaybackEventBody } from "./playReport";
import * as Q from "./queue";
import type { Random } from "./shuffle";
import { displayCause, type TriggerCause } from "./sources/fallbackPlan";
import { skipText } from "./stateLine";
import { isAbort, SourceFailure } from "./sources/ports";
import type { AttachedSource, Resolved, ResolveOptions } from "./sources/resolver";
import { CROSSFADE_MAX_S } from "./audio/transitionPolicy";
import { clampVolume, nextTempo, type Tempo } from "./tempo";
import {
  primarySource,
  isStation,
  NETWORK_CAUSES,
  SYSTEM_DEFAULT,
  type Cause,
  type FallbackInfo,
  type Notice,
  type OutputView,
  type PauseReason,
  type PlayerView,
  type QueueEntry,
  type RepeatMode,
  type SourceKind,
  type Status,
  type StreamInfo,
  type Track,
} from "./types";

export const BUFFERING_AFTER_MS = 300;
export const NATURAL_END_WINDOW_MS = 1500;
export const EXPIRY_MARGIN_MS = 15_000;
export const NETWORK_STREAK_LIMIT = 3;
export const RETRY_REFILL_MS = 3000;
export const STALL_MS = 8000;
export const RESOLVE_MS = 10_000;
export const START_BUDGET_MS = 25_000;
export const RETRY_AFTER_MS = 60_000;

export interface ResolverLike {
  resolve(track: Track, options: ResolveOptions): Promise<Resolved>;
  fallback(track: Track, cause: TriggerCause, failedSource: SourceKind, options: Omit<ResolveOptions, "bypassCache">): Promise<Resolved>;
  confirm(track: Track, resolved: Resolved): Promise<void>;
  reject(trackId: string, altId?: string): Promise<void>;
  forgetCached(trackId?: string): void;
  networkChanged(): void;
  pin(track: Track, resolved: Resolved): Promise<boolean>;
  dropCached(trackId: string): Promise<void>;
}

export interface PrecacheLike {
  setNext(track: Track | null): void;
  tick(entryId: string, positionMs: number, playing: boolean, steadyFromMs: number): void;
  statusChanged(status: Status): void;
  started(track: Track, resolved: Resolved): void;
  cancelAll(): void;
}

export interface EngineDeps {
  decks: DeckPort;
  resolver: ResolverLike;
  continuation: ContinuationPort;
  postReport(body: PlaybackEventBody): Promise<void>;
  storage: KeyValue;
  now(): number;
  random: Random;
  newId(): string;
  notify(notice: { kind: "error" | "info"; text: string; detail?: string }): void;
  askForSignIn(): void;
  network: { checkSoon(cause: Cause | "http_403"): void };
  online(): boolean;
  lyrics: { follow(track: Track | null): void; prefetch(track: Track): void };
  covers: { warm(url: string): void };
  precache?: PrecacheLike;
  mediaSession?: MediaSessionMirror;
  log(message: string, error?: unknown): void;
}

export interface PlayListOptions {
  startAt?: number;
  context?: string | null;
  listCover?: string | null;
  shuffled?: boolean;
}

export type SpanLookup = (trackId: string) => { startMs: number; endMs: number } | null;
export type TempoResolver = (track: Track) => { rate: number; semitones: number; linked: boolean; reverb: number | null };

interface LoadState {
  token: number;
  entryId: string;
  controller: AbortController;
  resolved: Resolved | null;
  retryUsed: boolean;
  recoveredAtMs: number;
  pendingSeekMs: number | null;
  pausedMeanwhile: boolean;
  confirmed: boolean;
  playStartedAt: number | null;
  lastProgressMs: number;
  verify: "waiting" | "running" | null;
  errorWhileVerifying: { cause: TriggerCause; code?: number } | null;
  failedAlts: Set<string>;
  failedClients: string[];
  lastCause: TriggerCause | null;
}

type Listener = (view: PlayerView) => void;

const REPORT_WAIT_MS = 3000;

export class Engine {
  private queue: Q.QueueState = Q.EMPTY_QUEUE;
  private status: Status = "idle";
  private pauseReason: PauseReason | null = null;
  private positionMs = 0;
  private durationMs = 0;
  private context: string | null = null;
  private listCover: string | null = null;
  private prefs: Prefs;
  private stream: StreamInfo | null = null;
  private fallbackInfo: FallbackInfo | null = null;
  private notice: Notice | null = null;
  private output: OutputView = { chosen: null, active: SYSTEM_DEFAULT, fellBack: false };

  private token = 0;
  private load: LoadState | null = null;
  private readonly history = new Q.PlayHistory();
  private readonly tracker: PlayTracker;
  private readonly outbox: ReportOutbox;
  private readonly refill: Refill;
  private readonly writer: SessionWriter;
  private written: { queue: Q.QueueState; context: string | null; listCover: string | null } | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private budgetTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly retryOwed = new Map<string, number>();
  private readonly retried = new Set<string>();
  private networkStreak = 0;
  private readonly checkedCauses = new Set<Cause | "http_403">();
  private passFailures = new Set<string>();
  private nextPair: string | null = null;
  private lyricsPending = false;
  private prefetchedFor: string | null = null;
  private steadyFromMs = 0;
  private tempoResolver: TempoResolver | null = null;
  private spans: SpanLookup | null = null;
  private lastReport: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<Listener>();
  private view: PlayerView;
  private commandListeners = new Set<() => void>();
  private disposed = false;
  private unsubscribeDeck: Array<() => void> = [];

  constructor(private readonly deps: EngineDeps) {
    this.tracker = new PlayTracker(deps.now, deps.newId);
    this.outbox = new ReportOutbox(deps.storage, (body) => deps.postReport(body), deps.now, deps.log);
    // Rank only after the last play report is stored, so the daemon sees this session's newest finish or skip.
    const continuation: ContinuationPort = {
      next: async (request) => {
        await this.settledReports();
        return deps.continuation.next(request);
      },
    };
    this.refill = new Refill(
      continuation,
      () => this.buildRefill(),
      (message, error) => deps.log(message, error),
    );
    this.writer = new SessionWriter(() => {
      this.writeSession();
      this.outbox.checkpoint(this.tracker.peek());
    }, deps.now);
    migrateLegacy(deps.storage, deps.newId);
    this.prefs = loadPrefs(deps.storage);
    deps.decks.setVolume(this.prefs.volume);
    deps.decks.setTempo(this.tempo);
    deps.decks.setReverb(this.prefs.reverbOn, this.prefs.reverbLevel);
    this.unsubscribeDeck = [deps.decks.on((event) => this.onDeckEvent(event)), deps.decks.onSwitch((entryId) => this.onPreparedSwitch(entryId))];
    if (this.prefs.restoreSession) this.restoreSaved(loadSession(deps.storage));
    this.view = this.buildView();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribeDeck) unsubscribe();
    this.unsubscribeDeck = [];
    this.refill.cancel();
    this.writer.flush();
    this.clearTimers();
    this.load?.controller.abort();
    this.load?.resolved?.source.release();
    this.load = null;
    this.token += 1;
    this.deps.lyrics.follow(null);
    this.deps.mediaSession?.release();
    this.listeners.clear();
    this.commandListeners.clear();
  }

  getView(): PlayerView {
    return this.view;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onCommand(listener: () => void): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  livePositionMs(): number {
    return this.load && this.deps.decks.holds(this.load.token) ? this.deps.decks.positionMs() : this.positionMs;
  }

  audioTime(): { nowMs: number; latencyMs: number } | null {
    return this.deps.decks.audioTime();
  }

  setTempoResolver(resolver: TempoResolver | null): void {
    this.tempoResolver = resolver;
  }

  setSpans(lookup: SpanLookup | null): void {
    this.spans = lookup;
    this.deps.decks.setSpanResolver?.(
      lookup &&
        ((trackId, durationMs) => {
          const span = lookup(trackId);
          return span ? { startMs: span.startMs, endMs: durationMs > 0 ? Math.min(span.endMs, durationMs) : span.endMs } : { startMs: 0, endMs: durationMs };
        }),
    );
  }

  private spanEndMs(track: Track): number | null {
    const end = this.spans?.(track.id)?.endMs;
    const duration = this.durationMs > 0 ? this.durationMs : track.durationMs;
    return end !== undefined && (duration <= 0 || end < duration - NATURAL_END_WINDOW_MS) ? end : null;
  }

  setOutput(output: OutputView): void {
    this.output = output;
    this.publish();
  }

  private buildView(): PlayerView {
    const current = Q.current(this.queue);
    const upcoming = Q.upcoming(this.queue);
    return {
      status: this.status,
      pauseReason: this.status === "paused" ? this.pauseReason : null,
      entries: this.queue.entries,
      index: this.queue.index,
      current,
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      context: this.context,
      listCover: this.listCover,
      continuing: upcoming.length > 0 && upcoming.every((e) => e.origin === "continuation"),
      repeat: this.prefs.repeat,
      shuffle: this.prefs.shuffle,
      volume: this.prefs.volume,
      tempo: { rate: this.prefs.rate, semitones: this.prefs.semitones, linked: this.prefs.linked, keepAcrossTracks: this.prefs.keepTempo },
      reverb: { on: this.prefs.reverbOn, level: this.prefs.reverbLevel },
      output: this.output,
      bestQuality: this.prefs.bestQuality,
      stream: this.stream,
      fallback: this.fallbackInfo,
      notice: this.notice,
    };
  }

  private publish(): void {
    this.view = this.buildView();
    this.deps.mediaSession?.update(this.view, this.load !== null && this.deps.decks.holds(this.load.token));
    for (const listener of this.listeners) listener(this.view);
  }

  private commandRan(): void {
    for (const listener of this.commandListeners) listener();
  }

  private get station(): boolean {
    return isStation(this.context);
  }

  private get tempo(): Tempo {
    return { rate: this.prefs.rate, semitones: this.prefs.semitones, linked: this.prefs.linked };
  }

  private setStatus(status: Status, reason: PauseReason | null = null): void {
    this.status = status;
    this.pauseReason = status === "paused" ? reason : null;
    this.tracker.observe(status === "playing");
    this.deps.precache?.statusChanged(status);
  }

  playList(tracks: Track[], options: PlayListOptions = {}): void {
    if (this.disposed) return;
    if (tracks.length === 0) return;
    this.commandRan();
    if (options.context !== undefined) this.context = options.context;
    if (options.listCover !== undefined) this.listCover = options.listCover;
    if (options.shuffled) {
      this.prefs.shuffle = true;
      this.queue = Q.fromListShuffled(tracks, options.startAt, this.deps.random, this.deps.newId);
      this.savePrefs();
    } else {
      this.queue = Q.fromList(tracks, options.startAt ?? 0, this.prefs.shuffle, this.deps.random, this.deps.newId);
    }
    this.passFailures.clear();
    // the queue was replaced, so startEntry cannot see a track change: the new list's track follows
    this.lyricsPending = true;
    this.startEntry(this.queue.index);
  }

  playEntry(entryId: string): void {
    if (this.disposed) return;
    const index = this.queue.entries.findIndex((e) => e.entryId === entryId);
    if (index < 0) return;
    this.commandRan();
    this.startEntry(index);
  }

  startRadio(track: Track): void {
    if (this.disposed) return;
    this.commandRan();
    this.context = `radio:${track.id}`;
    this.listCover = track.coverUrl || null;
    if (this.prefs.repeat === "all") this.setRepeat("off");
    this.queue = Q.fromList([track], 0, false, this.deps.random, this.deps.newId);
    this.passFailures.clear();
    // the queue was replaced, so startEntry cannot see a track change: the new list's track follows
    this.lyricsPending = true;
    this.startEntry(0);
    void this.refill.now();
  }

  toggle(): void {
    if (this.status === "playing" || this.status === "loading") this.pause();
    else this.play();
  }

  pause(): void {
    if (this.disposed) return;
    this.commandRan();
    this.pauseWith("user");
  }

  pauseFor(reason: "sleep" | "device_lost"): void {
    if (this.disposed) return;
    if (this.status !== "playing" && this.status !== "loading") return;
    this.pauseWith(reason);
  }

  private pauseWith(reason: PauseReason): void {
    const load = this.load;
    if (this.status === "loading" && load && !this.deps.decks.holds(load.token)) {
      load.controller.abort();
      load.resolved?.source.release();
      this.load = null;
      this.deps.decks.reset();
    } else if (this.status === "playing" || this.status === "loading") {
      if (load) load.pausedMeanwhile = true;
      this.positionMs = this.livePositionMs();
      void this.deps.decks.pause().catch(() => undefined);
    } else {
      return;
    }
    this.clearTimers();
    this.setStatus("paused", reason);
    this.publish();
    this.writer.flush();
  }

  play(): void {
    if (this.disposed) return;
    this.commandRan();
    this.resume();
  }

  resume(): void {
    if (this.disposed) return;
    if (this.status === "playing" || this.status === "loading") return;
    const entry = Q.current(this.queue);
    if (!entry) return;
    if (this.pauseReason === "network") this.networkStreak = 0;
    if (this.status === "idle" || this.needsReload()) {
      this.startEntry(this.queue.index, { positionMs: this.status === "idle" ? undefined : this.positionMs, keepPlay: this.status !== "idle" });
      return;
    }
    const load = this.load!;
    load.pausedMeanwhile = false;
    const token = load.token;
    this.setStatus("loading");
    this.notice = null;
    this.publish();
    this.deps.decks.resume().then(
      () => undefined,
      (error: unknown) => {
        if (this.load?.token !== token || this.load.pausedMeanwhile) return;
        const name = (error as { name?: string })?.name;
        if (name === "NotAllowedError") {
          this.setStatus("paused", "autoplay_blocked");
          this.publish();
        } else if (name !== "AbortError" && !load.retryUsed) {
          this.recover(load, "media_error");
        } else if (name !== "AbortError") {
          this.setStatus("paused", "user");
          this.publish();
        }
      },
    );
  }

  private needsReload(): boolean {
    const load = this.load;
    const entry = Q.current(this.queue);
    if (!load || !entry || load.entryId !== entry.entryId || !load.resolved) return true;
    if (this.deps.decks.hasError() || !this.deps.decks.holds(load.token)) return true;
    const expires = load.resolved.source.expiresAt;
    return expires !== undefined && expires - this.deps.now() <= EXPIRY_MARGIN_MS;
  }

  seekTo(positionMs: number, options: { andPlay?: boolean } = {}): void {
    if (this.disposed) return;
    const entry = Q.current(this.queue);
    if (!entry || !Number.isFinite(positionMs)) return;
    this.commandRan();
    const limit = this.durationMs > 0 ? this.durationMs : entry.track.durationMs;
    const target = Math.min(Math.max(0, positionMs), limit > 0 ? limit : Number.MAX_SAFE_INTEGER);
    const from = this.livePositionMs();
    const load = this.load;
    const attached = load !== null && load.entryId === entry.entryId && this.deps.decks.holds(load.token);
    if (attached && load.resolved) {
      this.tracker.seek(from, target);
      this.deps.decks.seek(target);
      this.positionMs = target;
      this.steadyFromMs = target;
      if (options.andPlay && this.status === "paused") this.resume();
      this.publish();
      return;
    }
    if (this.status === "loading" && load && load.entryId === entry.entryId) {
      load.pendingSeekMs = target;
      this.positionMs = target;
      this.publish();
      return;
    }
    this.positionMs = target;
    if (this.status === "playing" || options.andPlay) this.startEntry(this.queue.index, { positionMs: target, keepPlay: true });
    else this.publish();
    this.writer.changed();
  }

  next(): void {
    if (this.disposed) return;
    if (this.queue.index < 0) return;
    this.commandRan();
    const step = Q.nextStep(this.queue, this.prefs.repeat, this.station, false);
    if (step.kind === "index") {
      const entry = this.queue.entries[step.index];
      if (this.load && this.deps.decks.switchNow(entry.entryId, this.token + 1)) {
        this.adoptSwitch(step.index, false);
        return;
      }
    }
    this.advance(step);
  }

  previous(): void {
    if (this.disposed) return;
    const current = Q.current(this.queue);
    const startMs = (current && this.spans?.(current.track.id)?.startMs) || 0;
    const step = Q.previousStep(this.queue, this.history, this.livePositionMs() - startMs, this.prefs.repeat, this.station);
    if (!step) return;
    this.commandRan();
    if (step.kind === "restart") {
      this.seekTo(startMs);
      return;
    }
    this.startEntry(step.index, { viaHistory: true });
  }

  append(track: Track): void {
    if (this.disposed) return;
    this.queue = Q.append(this.queue, track, this.deps.newId);
    this.queueChanged();
  }

  insertNext(track: Track): void {
    if (this.disposed) return;
    const wasEmpty = this.queue.index < 0;
    this.queue = Q.insertNext(this.queue, track, this.deps.newId);
    if (wasEmpty) {
      this.lyricsPending = true;
      this.startEntry(0);
    } else this.queueChanged();
  }

  remove(entryId: string): QueueEntry | null {
    if (this.disposed) return null;
    const removed = this.queue.entries.find((e) => e.entryId === entryId) ?? null;
    const next = Q.remove(this.queue, entryId);
    if (!next) return null;
    this.queue = next;
    this.queueChanged();
    return removed;
  }

  restore(entry: QueueEntry, index: number): void {
    if (this.disposed) return;
    this.queue = Q.restore(this.queue, entry, index);
    this.queueChanged();
  }

  move(entryId: string, targetIndex: number): void {
    if (this.disposed) return;
    const next = Q.move(this.queue, entryId, targetIndex);
    if (!next) return;
    this.queue = next;
    this.queueChanged();
  }

  trimToCurrent(): void {
    if (this.disposed) return;
    this.queue = Q.trimToCurrent(this.queue);
    this.context = null;
    this.listCover = null;
    this.queueChanged();
  }

  private queueChanged(): void {
    this.evaluateNext();
    this.publish();
    this.writer.changed();
  }

  setRepeat(mode: RepeatMode): void {
    if (this.disposed) return;
    this.prefs.repeat = this.station && mode === "all" ? "off" : mode;
    this.savePrefs();
    this.queueChanged();
  }

  cycleRepeat(): void {
    if (this.disposed) return;
    const order: RepeatMode[] = this.station ? ["off", "one"] : ["off", "all", "one"];
    const at = order.indexOf(this.prefs.repeat);
    this.setRepeat(order[(at + 1) % order.length]);
  }

  setShuffle(on: boolean): void {
    if (this.disposed) return;
    if (on === this.prefs.shuffle) return;
    this.prefs.shuffle = on;
    this.queue = on ? Q.shuffleUpcoming(this.queue, this.deps.random) : Q.unshuffleUpcoming(this.queue);
    this.savePrefs();
    this.queueChanged();
  }

  changeVolume(gain: number): void {
    if (this.disposed) return;
    this.prefs.volume = clampVolume(gain);
    this.deps.decks.setVolume(this.prefs.volume);
    this.savePrefs();
    this.publish();
  }

  setTempo(change: { rate?: number; semitones?: number; linked?: boolean }): void {
    if (this.disposed) return;
    const next = nextTempo(this.tempo, change);
    this.prefs.rate = next.rate;
    this.prefs.semitones = next.semitones;
    this.prefs.linked = next.linked;
    this.deps.decks.setTempo(next);
    this.savePrefs();
    this.publish();
  }

  setKeepTempo(on: boolean): void {
    if (this.disposed) return;
    this.prefs.keepTempo = on;
    this.savePrefs();
    this.publish();
  }

  setReverb(change: { on?: boolean; level?: number }): void {
    if (this.disposed) return;
    if (change.on !== undefined) this.prefs.reverbOn = change.on;
    if (change.level !== undefined && Number.isFinite(change.level)) this.prefs.reverbLevel = Math.min(1, Math.max(0, change.level));
    this.deps.decks.setReverb(this.prefs.reverbOn, this.prefs.reverbLevel);
    this.savePrefs();
    this.publish();
  }

  setPauseOnDeviceLoss(on: boolean): void {
    if (this.disposed) return;
    this.prefs.pauseOnDeviceLoss = on;
    this.savePrefs();
  }

  get pauseOnDeviceLoss(): boolean {
    return this.prefs.pauseOnDeviceLoss;
  }

  setRestoreSession(on: boolean): void {
    if (this.disposed) return;
    this.prefs.restoreSession = on;
    this.savePrefs();
    this.writer.flush();
  }

  get restoreSession(): boolean {
    return this.prefs.restoreSession;
  }

  setRememberedOutput(device: { id: string; label: string } | null): void {
    if (this.disposed) return;
    this.prefs.output = device;
    this.savePrefs();
  }

  get rememberedOutput(): { id: string; label: string } | null {
    return this.prefs.output;
  }

  setBestQuality(on: boolean): void {
    if (this.disposed) return;
    this.prefs.bestQuality = on;
    this.savePrefs();
    this.publish();
  }

  setCrossfade(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    this.prefs.crossfadeSeconds = Math.round(Math.min(CROSSFADE_MAX_S, Math.max(0, seconds)));
    this.savePrefs();
  }

  get crossfadeSeconds(): number {
    return this.prefs.crossfadeSeconds;
  }

  async keepVersion(): Promise<boolean> {
    const entry = Q.current(this.queue);
    const resolved = this.load?.resolved;
    if (!entry || !resolved) return false;
    const pinned = await this.deps.resolver.pin(entry.track, resolved);
    if (pinned) this.fallbackInfo = null;
    this.publish();
    return pinned;
  }

  async rejectAlternative(trackId: string): Promise<void> {
    const playing = Q.current(this.queue)?.track.id === trackId ? this.load?.resolved?.altId : undefined;
    await this.deps.resolver.reject(trackId, playing);
  }

  async forgetSession(): Promise<void> {
    const report = this.endPlay("stop");
    this.refill.cancel();
    this.deps.precache?.cancelAll();
    this.load?.controller.abort();
    this.load?.resolved?.source.release();
    this.load = null;
    this.token += 1;
    this.deps.decks.reset();
    this.clearTimers();
    this.queue = Q.EMPTY_QUEUE;
    this.positionMs = 0;
    this.durationMs = 0;
    this.context = null;
    this.listCover = null;
    this.notice = null;
    this.stream = null;
    this.fallbackInfo = null;
    this.history.clear();
    this.setStatus("idle");
    this.deps.lyrics.follow(null);
    this.publish();
    this.writer.flush();
    await report;
  }

  async beforeQuit(): Promise<void> {
    this.positionMs = this.livePositionMs();
    const report = this.endPlay("stop");
    this.writer.flush();
    await report;
  }

  cacheCleared(): void {
    this.deps.resolver.forgetCached();
    this.deps.precache?.cancelAll();
  }

  private startEntry(index: number, options: { positionMs?: number; viaHistory?: boolean; keepPlay?: boolean; bypassCache?: boolean } = {}): void {
    const entry = this.queue.entries[index];
    if (!entry) return;
    if (!options.keepPlay || !this.tracker.active) {
      this.endPlay("change");
      this.tracker.begin(entry, this.context);
    }
    this.load?.controller.abort();
    this.token += 1;
    const token = this.token;
    const previousTrack = Q.current(this.queue)?.track.id;
    this.queue = { entries: this.queue.entries, index };
    this.clearTimers();
    this.setStatus("loading");
    this.positionMs = options.positionMs ?? this.spans?.(entry.track.id)?.startMs ?? 0;
    this.steadyFromMs = this.positionMs;
    this.durationMs = entry.track.durationMs;
    this.stream = null;
    this.fallbackInfo = null;
    if (!options.viaHistory) this.history.started(entry.entryId);
    if (!options.keepPlay && previousTrack !== entry.track.id) this.applyTrackTempo(entry.track);
    this.load = {
      token,
      entryId: entry.entryId,
      controller: new AbortController(),
      resolved: null,
      retryUsed: false,
      recoveredAtMs: 0,
      pendingSeekMs: null,
      pausedMeanwhile: false,
      confirmed: false,
      playStartedAt: null,
      lastProgressMs: this.positionMs,
      verify: null,
      errorWhileVerifying: null,
      failedAlts: new Set(),
      failedClients: [],
      lastCause: null,
    };
    this.armBudget(this.load);
    this.publish();
    this.writer.flush();
    // Lyrics and covers stay off the start path: they follow the first `playing`.
    if (previousTrack !== entry.track.id) this.lyricsPending = true;
    this.evaluateNext();
    this.evaluateRefill();
    void this.attach(this.load, entry, this.positionMs, options.bypassCache ?? false);
  }

  private applyTrackTempo(track: Track): void {
    if (this.tempoResolver) {
      const memory = this.tempoResolver(track);
      this.prefs.rate = memory.rate;
      this.prefs.semitones = memory.semitones;
      this.prefs.linked = memory.linked;
      this.prefs.reverbOn = memory.reverb !== null;
      if (memory.reverb !== null) this.prefs.reverbLevel = memory.reverb;
      this.deps.decks.setReverb(this.prefs.reverbOn, this.prefs.reverbLevel);
    } else if (!this.prefs.keepTempo) {
      this.prefs.rate = 1;
      this.prefs.semitones = 0;
    } else {
      return;
    }
    this.deps.decks.setTempo(this.tempo);
    this.savePrefs();
  }

  private async attach(load: LoadState, entry: QueueEntry, positionMs: number, bypassCache: boolean): Promise<void> {
    const attempt = new AbortController();
    const signal = AbortSignal.any([load.controller.signal, attempt.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced, not only aborted: a step that ignores its signal must not hold the start.
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), RESOLVE_MS);
    });
    const running = this.deps.resolver.resolve(entry.track, { positionMs, bypassCache, bestQuality: this.prefs.bestQuality, signal, early: true });
    let resolved: Resolved;
    try {
      const first = await Promise.race([running, timedOut]);
      if (first === "timeout") {
        attempt.abort();
        running.then(
          (late) => late.source.release(),
          () => undefined,
        );
        if (this.load === load) void this.fallBack(load, "timeout");
        return;
      }
      resolved = first;
    } catch (error) {
      if (this.load !== load || isAbort(error)) return;
      this.startFailed(load, entry, error);
      return;
    } finally {
      clearTimeout(timer);
    }
    if (this.load !== load) {
      resolved.source.release();
      return;
    }
    await this.startPlayback(load, entry, resolved, load.pendingSeekMs ?? (resolved.startAtMs || positionMs));
  }

  private async startPlayback(load: LoadState, entry: QueueEntry, resolved: Resolved, startMs: number): Promise<void> {
    load.resolved = resolved;
    load.pendingSeekMs = null;
    load.lastProgressMs = startMs;
    this.stream = resolved.verify ? null : resolved.stream;
    load.verify = resolved.verify ? "waiting" : null;
    load.errorWhileVerifying = null;
    this.fallbackInfo = resolved.fallback;
    this.positionMs = startMs;
    this.tracker.setSource(resolved.stream.source, resolved.fallback?.cause);
    this.watchProgressive(load, resolved.source);
    this.publish();
    // Before the load: `play()` may never settle on a stream that does not answer.
    this.armStall(load);
    try {
      await this.deps.decks.load({ token: load.token, trackId: entry.track.id, source: resolved.source, positionMs: startMs, tempo: this.tempo, play: true });
    } catch (error) {
      if (this.load !== load || load.pausedMeanwhile) return;
      const name = (error as { name?: string })?.name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError") {
        this.setStatus("paused", "autoplay_blocked");
        this.publish();
        return;
      }
      this.recover(load, "media_error");
      return;
    }
    if (this.load === load) load.playStartedAt = this.deps.now();
  }

  // The probe waits for the stream's answer: googlevideo serves one request after the other
  private verifyEarly(load: LoadState, error?: { cause: TriggerCause; code?: number }): boolean {
    if (load.verify === "running") {
      if (error) load.errorWhileVerifying = error;
      return true;
    }
    const early = load.resolved;
    if (load.verify !== "waiting" || !early?.verify) return false;
    load.verify = "running";
    load.errorWhileVerifying = error ?? null;
    early.verify().then(
      (final) => {
        const replaced = final.source.url !== early.source.url;
        if (this.load !== load || load.resolved !== early) {
          if (replaced) final.source.release();
          return;
        }
        load.verify = null;
        const failed = load.errorWhileVerifying;
        load.errorWhileVerifying = null;
        const entry = Q.current(this.queue);
        if (replaced && failed && entry) {
          void this.startPlayback(load, entry, final, this.livePositionMs());
          return;
        }
        if (replaced) {
          this.deps.decks.swapSource(load.token, final.source);
          early.source.release();
        }
        load.resolved = final;
        this.stream = final.stream;
        if (load.confirmed && entry) this.deps.precache?.started(entry.track, final);
        this.publish();
        if (failed && !replaced) this.recover(load, failed.cause, failed.code);
      },
      (reason: unknown) => {
        if (this.load !== load || load.resolved !== early || isAbort(reason)) return;
        load.verify = null;
        this.recover(load, "media_error");
      },
    );
    return true;
  }

  private watchProgressive(load: LoadState, source: AttachedSource): void {
    if (source.kind !== "progressive" || !source.whole) return;
    source.whole.then(
      (blob) => {
        if (this.load !== load || !source.overflowed?.()) return;
        const url = URL.createObjectURL(blob);
        const whole: AttachedSource = {
          ...source,
          kind: "object",
          url,
          bytes: blob,
          whole: undefined,
          release: () => URL.revokeObjectURL(url),
        };
        this.deps.decks.swapSource(load.token, whole);
        source.release();
        if (load.resolved) load.resolved = { ...load.resolved, source: whole };
      },
      () => undefined,
    );
  }

  private startFailed(load: LoadState, entry: QueueEntry, error: unknown): void {
    const failure = error instanceof SourceFailure ? error : new SourceFailure("unavailable");
    if (failure.detail.signIn) {
      this.setStatus("paused", "sign_in");
      this.publish();
      this.deps.askForSignIn();
      return;
    }
    this.skipFailed(load, entry, failure.cause, failure.detail.original);
  }

  private skipFailed(load: LoadState, entry: QueueEntry, cause: Cause, reportReason: string = cause): void {
    if (this.load !== load) return;
    this.notice = { kind: "skipped", title: entry.track.title, cause };
    if (!this.retried.has(entry.entryId)) {
      this.retryOwed.set(entry.entryId, this.deps.now());
      this.deps.notify({ kind: "info", text: skipText(entry.track.title, cause, reportReason) });
    }
    this.tracker.setSource(this.stream?.source ?? primarySource(entry.track.id), reportReason);
    this.endPlay("error");
    this.passFailures.add(entry.entryId);
    this.networkStreak = NETWORK_CAUSES.has(cause) ? this.networkStreak + 1 : 0;
    this.clearTimers();
    if (NETWORK_CAUSES.has(cause)) this.checkNetwork(reportReason === "http_403" ? "http_403" : cause);
    const step = Q.nextStep(this.queue, this.prefs.repeat === "one" ? "off" : this.prefs.repeat, this.station, false);
    if (this.networkStreak >= NETWORK_STREAK_LIMIT) {
      this.stopForNetwork(step, cause);
      return;
    }
    this.load = null;
    this.advance(step, { afterFailure: true });
  }

  private stopForNetwork(step: Q.NextStep, cause: Cause, positionMs = 0): void {
    if (step.kind === "index") this.queue = { entries: this.queue.entries, index: step.index };
    else if (step.kind === "wrap") this.queue = { entries: this.queue.entries, index: 0 };
    this.clearTimers();
    this.load?.controller.abort();
    this.load = null;
    this.deps.decks.reset();
    // A prepared next track must not start the stopped player by itself.
    this.deps.decks.setCandidate(null);
    this.positionMs = positionMs;
    this.durationMs = Q.current(this.queue)?.track.durationMs ?? 0;
    this.setStatus("paused", "network");
    this.notice = { kind: "network", cause };
    this.checkNetwork(cause);
    this.publish();
    this.writer.flush();
  }

  private checkNetwork(cause: Cause | "http_403"): void {
    if (this.checkedCauses.has(cause)) return;
    this.checkedCauses.add(cause);
    this.deps.network.checkSoon(cause);
  }

  private advance(step: Q.NextStep, options: { afterFailure?: boolean } = {}): void {
    switch (step.kind) {
      case "index":
        this.startEntry(step.index);
        return;
      case "wrap":
        if (options.afterFailure && this.passFailures.size >= this.queue.entries.length) {
          this.notice = { kind: "queue_failed" };
          this.endState();
          return;
        }
        if (this.prefs.shuffle) this.queue = Q.reshuffleForWrap(this.queue, this.deps.random);
        this.passFailures.clear();
        this.startEntry(0);
        return;
      case "more":
        void this.waitForMore(options.afterFailure ?? false);
        return;
      case "none":
        return;
    }
  }

  private async waitForMore(afterFailure: boolean): Promise<void> {
    const before = this.queue.entries.length;
    const token = this.token;
    this.setStatus("loading");
    this.publish();
    await this.refill.now();
    if (this.token !== token || this.status !== "loading") return;
    if (this.queue.entries.length > before) {
      this.startEntry(before);
      return;
    }
    if (this.retryFailed()) return;
    if (afterFailure && this.passFailures.size >= this.queue.entries.length) {
      this.notice = { kind: "queue_failed" };
    }
    this.endState();
  }

  private retryFailed(ignoreWait = false): boolean {
    const now = this.deps.now();
    for (const [entryId, failedAt] of this.retryOwed) {
      if (!ignoreWait && now - failedAt < RETRY_AFTER_MS) continue;
      this.retryOwed.delete(entryId);
      if (!this.queue.entries.some((entry) => entry.entryId === entryId)) continue;
      this.retried.add(entryId);
      this.queue = Q.move(this.queue, entryId, this.queue.entries.length - 1) ?? this.queue;
      this.startEntry(this.queue.entries.findIndex((entry) => entry.entryId === entryId));
      return true;
    }
    return false;
  }

  networkChanged(): void {
    if (this.disposed) return;
    this.deps.resolver.networkChanged();
    this.networkStreak = 0;
    this.checkedCauses.clear();
    if (!this.deps.online()) return;
    if (this.status === "paused" && this.pauseReason === "network") {
      this.resume();
      return;
    }
    if (this.status === "idle" && this.notice?.kind === "queue_failed") {
      this.notice = null;
      this.passFailures.clear();
      if (!this.retryFailed(true)) this.startEntry(this.queue.index);
    }
  }

  private endState(): void {
    this.endPlay("change");
    this.deps.decks.reset();
    this.load = null;
    this.positionMs = 0;
    this.setStatus("idle");
    this.publish();
    this.writer.flush();
  }

  private onDeckEvent(event: DeckEvent): void {
    const load = this.load;
    if (!load || event.token !== load.token) return;
    switch (event.type) {
      case "playing":
        this.cancelWait();
        this.verifyEarly(load);
        if (load.pausedMeanwhile || this.status === "paused") return;
        this.setStatus("playing");
        this.networkStreak = 0;
        this.passFailures.clear();
        this.retryOwed.delete(load.entryId);
        this.armStall(load);
        this.evaluateNext();
        this.notice = this.notice?.kind === "skipped" ? this.notice : null;
        this.afterFirstPlaying();
        if (!load.confirmed && load.resolved) {
          load.confirmed = true;
          const entry = Q.current(this.queue);
          if (entry) {
            void this.deps.resolver.confirm(entry.track, load.resolved).catch(() => undefined);
            // An unverified URL is never handed to the daemon; verifyEarly does it once verified.
            if (!load.verify) this.deps.precache?.started(entry.track, load.resolved);
          }
        }
        this.publish();
        return;
      case "pause":
        this.cancelWait();
        if (this.status === "playing") {
          this.positionMs = event.positionMs;
          this.setStatus("paused", "user");
          this.publish();
        }
        return;
      case "waiting":
        this.cancelWait();
        this.waitTimer = setTimeout(() => {
          this.waitTimer = null;
          if (this.status === "playing" && this.load === load) {
            this.setStatus("loading");
            this.publish();
          }
        }, BUFFERING_AFTER_MS);
        return;
      case "canplay":
      case "emptied":
        this.cancelWait();
        return;
      case "seeked":
        if (event.enoughData) this.cancelWait();
        return;
      case "durationchange":
        if (event.durationMs > 0) {
          this.durationMs = event.durationMs;
          if (load.pendingSeekMs !== null && load.resolved) {
            this.deps.decks.seek(load.pendingSeekMs);
            load.pendingSeekMs = null;
          }
          this.publish();
        }
        return;
      case "timeupdate":
        this.onTimeUpdate(load, event);
        return;
      case "ended":
        if (this.durationMs > 0 && event.positionMs >= this.durationMs - NATURAL_END_WINDOW_MS) this.naturalEnd();
        return;
      case "error": {
        const failure: { cause: TriggerCause; code?: number } =
          event.error?.httpStatus === 403 ? { cause: "http_403" } : { cause: "media_error", code: event.error?.code };
        if (this.verifyEarly(load, failure)) return;
        this.recover(load, failure.cause, failure.code);
        return;
      }
    }
  }

  private onTimeUpdate(load: LoadState, event: DeckEvent): void {
    if (this.status === "loading") return;
    this.positionMs = event.positionMs;
    // Any change counts: a backward seek or an A-B loop is progress too.
    if (event.positionMs !== load.lastProgressMs) {
      load.lastProgressMs = event.positionMs;
      if (this.budgetTimer) this.clearBudget();
      if (this.status === "playing") this.armStall(load);
    }
    if (load.retryUsed && event.positionMs >= load.recoveredAtMs + RETRY_REFILL_MS) load.retryUsed = false;
    this.tracker.observe(this.status === "playing");
    this.deps.precache?.tick(load.entryId, event.positionMs, this.status === "playing", this.steadyFromMs);
    const entry = Q.current(this.queue);
    const endMs = entry && this.status === "playing" ? this.spanEndMs(entry.track) : null;
    if (endMs !== null && event.positionMs >= endMs) {
      this.trimmedEnd();
      return;
    }
    this.publish();
    this.writer.changed();
  }

  private armStall(load: LoadState): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (this.load !== load || this.status === "paused") return;
      if (!this.deps.online()) {
        this.stopForNetwork({ kind: "none" }, "offline", this.livePositionMs());
        return;
      }
      void this.fallBack(load, "stall");
    }, STALL_MS);
  }

  private armBudget(load: LoadState): void {
    this.clearBudget();
    this.budgetTimer = setTimeout(() => {
      this.budgetTimer = null;
      const entry = Q.current(this.queue);
      if (this.load !== load || !entry || this.status === "paused") return;
      if (!this.deps.online()) {
        this.stopForNetwork({ kind: "none" }, "offline", this.livePositionMs());
        return;
      }
      const cause = load.lastCause ?? "timeout";
      load.controller.abort();
      this.skipFailed(load, entry, displayCause(cause), cause);
    }, START_BUDGET_MS);
  }

  private clearBudget(): void {
    if (this.budgetTimer) clearTimeout(this.budgetTimer);
    this.budgetTimer = null;
  }

  private naturalEnd(): void {
    const loop = this.prefs.repeat === "one";
    this.tracker.complete(loop);
    const step = Q.nextStep(this.queue, this.prefs.repeat, this.station, true);
    if (step.kind === "index" && step.index === this.queue.index) {
      this.startEntry(step.index, { keepPlay: true });
      return;
    }
    this.advance(step);
  }

  // shortcut: without a prepared deck the end is up to 250 ms late (timeupdate); a deck end timer fixes it
  private trimmedEnd(): void {
    const step = Q.nextStep(this.queue, this.prefs.repeat, this.station, true);
    if (step.kind === "index" && step.index !== this.queue.index && this.deps.decks.switchNow(this.queue.entries[step.index].entryId, this.token + 1)) {
      this.tracker.complete();
      this.adoptSwitch(step.index, true);
      return;
    }
    this.naturalEnd();
  }

  private onPreparedSwitch(entryId: string): void {
    const index = this.queue.entries.findIndex((e) => e.entryId === entryId);
    if (index < 0) return;
    this.tracker.complete(this.prefs.repeat === "one" && index === this.queue.index);
    this.adoptSwitch(index, true);
  }

  private adoptSwitch(index: number, completed: boolean): void {
    const entry = this.queue.entries[index];
    const previousTrack = Q.current(this.queue)?.track.id;
    if (!(completed && index === this.queue.index)) {
      this.endPlay("change");
      this.tracker.begin(entry, this.context);
    }
    this.tracker.setSource(primarySource(entry.track.id) === "local" ? "local" : "cache");
    if (previousTrack !== entry.track.id) this.applyTrackTempo(entry.track);
    this.load?.controller.abort();
    this.token += 1;
    this.deps.decks.claim(this.token);
    this.queue = { entries: this.queue.entries, index };
    this.history.started(entry.entryId);
    this.load = {
      token: this.token,
      entryId: entry.entryId,
      controller: new AbortController(),
      resolved: {
        source: { trackId: entry.track.id, kind: "cache", url: "", mime: "audio/*", release: () => undefined },
        stream: { source: "cache", codec: "", bitrateKbps: 0, fromCache: true },
        fallback: null,
        startAtMs: 0,
      },
      retryUsed: false,
      recoveredAtMs: 0,
      pendingSeekMs: null,
      pausedMeanwhile: false,
      confirmed: true,
      playStartedAt: this.deps.now(),
      lastProgressMs: 0,
      verify: null,
      errorWhileVerifying: null,
      failedAlts: new Set(),
      failedClients: [],
      lastCause: null,
    };
    this.armStall(this.load);
    this.positionMs = this.deps.decks.positionMs();
    this.durationMs = entry.track.durationMs;
    this.stream = this.load.resolved!.stream;
    this.fallbackInfo = null;
    this.setStatus("playing");
    this.deps.lyrics.follow(entry.track);
    this.evaluateNext();
    this.prefetchNeighbour();
    this.evaluateRefill();
    this.publish();
    this.writer.flush();
  }

  private recover(load: LoadState, cause: TriggerCause, mediaCode?: number): void {
    if (this.load !== load) return;
    const entry = Q.current(this.queue);
    if (!entry) return;
    if (load.resolved?.stream.fromCache) void this.deps.resolver.dropCached(entry.track.id);
    const position = this.livePositionMs();
    if (this.status === "paused") {
      // A paused player never starts audio by itself: play() sees the deck error and reloads at this position.
      this.positionMs = position;
      return;
    }
    if (!load.retryUsed && cause === "media_error") {
      this.startEntry(this.queue.index, { positionMs: position, keepPlay: true, bypassCache: true });
      this.load!.retryUsed = true;
      this.load!.recoveredAtMs = position;
      return;
    }
    // After recovery only network and not-supported media errors go to another source.
    const mediaTrigger = mediaCode === undefined || mediaCode === 2 || mediaCode === 4;
    if (cause === "media_error" && !mediaTrigger) {
      this.skipFailed(load, entry, "unavailable");
      return;
    }
    void this.fallBack(load, cause);
  }

  private async fallBack(load: LoadState, cause: TriggerCause): Promise<void> {
    const entry = Q.current(this.queue);
    if (!entry || this.load !== load || this.status === "paused") return;
    const position = this.livePositionMs();
    const failedSource = load.resolved?.stream.source ?? primarySource(entry.track.id);
    if (load.resolved?.altId) load.failedAlts.add(load.resolved.altId);
    if (load.resolved?.client) load.failedClients.push(load.resolved.client);
    load.lastCause = cause;
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
    if (!this.budgetTimer) this.armBudget(load);
    this.setStatus("loading");
    this.publish();
    try {
      const resolved = await this.deps.resolver.fallback(entry.track, cause, failedSource, {
        positionMs: position,
        bestQuality: this.prefs.bestQuality,
        signal: load.controller.signal,
        failedAlts: load.failedAlts,
        failedClients: load.failedClients,
      });
      if (this.load !== load) {
        resolved.source.release();
        return;
      }
      load.confirmed = false;
      await this.startPlayback(load, entry, resolved, resolved.startAtMs);
    } catch (error) {
      if (this.load !== load || isAbort(error)) return;
      this.skipFailed(
        load,
        entry,
        error instanceof SourceFailure ? error.cause : "unavailable",
        error instanceof SourceFailure ? error.detail.original : undefined,
      );
    }
  }

  private evaluateRefill(): void {
    const left = this.queue.entries.length - 1 - this.queue.index;
    if (this.station ? left <= 1 : left <= 0 && this.prefs.repeat === "off") this.refill.trigger();
  }

  private buildRefill(): ContinuationRequest & { accept(tracks: Suggested[]): void } {
    const station = this.station;
    const context = this.context;
    const token = this.token;
    const entries = this.queue.entries;
    const seed = context?.slice("radio:".length) ?? "";
    const contextId = context ? (context.includes(":") ? context.slice(context.indexOf(":") + 1) : context) : "queue";
    const seeds = station
      ? [seed]
      : [
          ...new Set(
            [...entries.slice(Math.max(0, this.queue.index - 4), this.queue.index + 1), ...entries.filter((e) => e.origin === "list")].map((e) => e.track.id),
          ),
        ].slice(0, MAX_SEED_IDS);
    return {
      context: station ? `radio:${seed}` : `continue:${contextId}`,
      seeds,
      recent: entries.map((e) => e.track.id).slice(-MAX_SEED_IDS),
      sessionId: this.tracker.session,
      limit: BATCH_SIZE,
      accept: (tracks) => {
        const valid = station ? this.context === context : this.token === token;
        if (!valid) return;
        const fresh = tracks.filter((t) => !(station && t.id === seed));
        const reasons = new Map(fresh.flatMap((t) => (t.reason ? [[t.id, t.reason] as const] : [])));
        // The reason lives on the queue entry, never on the Track that likes and playlists store.
        const plain = fresh.map(({ reason: _reason, ...t }) => t);
        this.queue = Q.appendBatch(this.queue, plain, this.prefs.shuffle, this.deps.random, this.deps.newId, reasons);
        this.queueChanged();
      },
    };
  }

  private evaluateNext(): void {
    const here = Q.current(this.queue);
    const next = Q.candidateAfter(this.queue, this.prefs.repeat, this.station);
    // While a start is on its way the deck still holds the old track: its end must not jump over the start.
    const startReached = this.status !== "loading" || this.load?.confirmed === true;
    const pair = `${here?.entryId ?? ""}>${next?.entryId ?? ""}>${startReached}`;
    if (pair === this.nextPair) return;
    this.nextPair = pair;
    this.deps.precache?.setNext(next?.track ?? null);
    const candidate: DeckCandidate | null = next && startReached ? { entryId: next.entryId, trackId: next.track.id, tempo: this.tempoFor(next.track) } : null;
    this.deps.decks.setCandidate(candidate);
    if (this.status !== "loading") this.prefetchNeighbour();
  }

  private prefetchNeighbour(): void {
    const pair = this.nextPair;
    if (!pair || pair === this.prefetchedFor) return;
    this.prefetchedFor = pair;
    const next = Q.candidateAfter(this.queue, this.prefs.repeat, this.station);
    if (!next) return;
    if (next.track.coverUrl) this.deps.covers.warm(next.track.coverUrl);
    this.deps.lyrics.prefetch(next.track);
  }

  private afterFirstPlaying(): void {
    if (this.lyricsPending) {
      this.lyricsPending = false;
      const entry = Q.current(this.queue);
      if (entry) this.deps.lyrics.follow(entry.track);
    }
    this.prefetchNeighbour();
  }

  private tempoFor(track: Track): Tempo {
    if (this.tempoResolver) {
      const memory = this.tempoResolver(track);
      return { rate: memory.rate, semitones: memory.semitones, linked: memory.linked };
    }
    return this.prefs.keepTempo ? this.tempo : { rate: 1, semitones: 0, linked: this.prefs.linked };
  }

  // Capped at REPORT_WAIT_MS: a hung daemon must not stall the music
  private async settledReports(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, REPORT_WAIT_MS)));
    const settled = (async () => {
      let seen: Promise<void>;
      do {
        seen = this.lastReport;
        await seen;
      } while (seen !== this.lastReport);
    })();
    await Promise.race([settled, deadline]);
    clearTimeout(timer);
  }

  private endPlay(kind: "change" | "error" | "stop"): Promise<void> {
    const body = this.tracker.end(kind);
    if (!body) {
      this.outbox.checkpoint(null);
      return this.lastReport;
    }
    this.lastReport = this.outbox.send(body);
    return this.lastReport;
  }

  flushReports(): Promise<void> {
    return this.outbox.flush();
  }

  private savePrefs(): void {
    savePrefs(this.deps.storage, this.prefs);
  }

  private writeSession(): void {
    if (!this.prefs.restoreSession) {
      this.written = null;
      saveSession(this.deps.storage, null, () => undefined);
      return;
    }
    const written = this.written;
    if (written && written.queue === this.queue && written.context === this.context && written.listCover === this.listCover && this.queue.entries.length > 0) {
      savePosition(this.deps.storage, {
        entryId: this.queue.entries[this.queue.index].entryId,
        positionMs: this.livePositionMs(),
        durationMs: this.durationMs,
      });
      return;
    }
    this.written = { queue: this.queue, context: this.context, listCover: this.listCover };
    const session: SavedSession | null =
      this.queue.entries.length === 0
        ? null
        : {
            entries: this.queue.entries,
            index: this.queue.index,
            positionMs: this.livePositionMs(),
            durationMs: this.durationMs,
            context: this.context,
            listCover: this.listCover,
          };
    saveSession(this.deps.storage, session, (message) => this.deps.log(message));
  }

  private restoreSaved(session: SavedSession | null): void {
    if (!session) return;
    this.queue = { entries: session.entries, index: session.index };
    this.positionMs = session.positionMs;
    this.durationMs = session.durationMs || session.entries[session.index].track.durationMs;
    this.context = session.context;
    this.listCover = session.listCover;
    this.status = "paused";
    this.pauseReason = "user";
  }

  private clearTimers(): void {
    this.cancelWait();
    this.clearBudget();
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private cancelWait(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
  }
}
