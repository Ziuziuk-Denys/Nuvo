import type { DeckCandidate, DeckEvent, DeckLoad, DeckPort } from "../deckPort";
import type { AttachedSource } from "../sources/resolver";
import { pitchStageActive, type Tempo } from "../tempo";
import type { RepeatMode } from "../types";
import { equalPower, FADE_MS, raisedCosine } from "./curves";
import { AudioGraph, type EqState, type GraphDeps } from "./graph";
import { PV_FRAME, PV_HOP } from "./phaseVocoder";
import type { SpectrumListener } from "./spectrum";

export const PREPARE_LEAD_MS = 15_000;
export const PREPARE_CAP_MS = 5000;
export const GAPLESS_MS = 10;
export const PLAIN_TAIL_MS = 30;
export const MANUAL_SKIP_MS = 120;
export const FINISH_EXTRA_MS = 50;
export const MASK_FALLBACK_MS = 120;
export const LOOKAHEAD_START_MS = 30;
export const LOOKAHEAD_MAX_MS = 80;

export interface Span {
  startMs: number;
  endMs: number;
}

export interface TransitionInput {
  current: Span;
  next: Span;
  rate: number;
  crossfadeSeconds: number;
  nextReady: boolean;
  albumInOrder: boolean;
  tempo: { current: Tempo; next: Tempo };
  reverb: { current: number | null; next: number | null };
  repeat: RepeatMode;
  abLoop: boolean;
  sleepAtTrackEnd: boolean;
}

export interface TransitionPlan {
  kind: "crossfade" | "gapless" | "plain" | "none";
  startAtMediaMs: number;
  fadeMs: number;
}

export type TransitionPolicy = (input: TransitionInput) => TransitionPlan;
export type SpanResolver = (trackId: string, elementDurationMs: number) => Span;

export const defaultPolicy: TransitionPolicy = (input) =>
  input.nextReady
    ? { kind: "gapless", startAtMediaMs: input.current.endMs - GAPLESS_MS * input.rate, fadeMs: GAPLESS_MS }
    : { kind: "plain", startAtMediaMs: input.current.endMs, fadeMs: 0 };

export interface DecksDeps {
  elements: [HTMLMediaElement, HTMLMediaElement];
  createContext(): AudioContext | null;
  graph: Omit<GraphDeps, "sources"> & { sources?: GraphDeps["sources"] };
  cacheUrl(trackId: string): string;
  isFullyCached(trackId: string): Promise<boolean>;
  dropCached(trackId: string): Promise<void>;
  transitionContext(): Pick<TransitionInput, "crossfadeSeconds" | "albumInOrder" | "repeat" | "abLoop" | "sleepAtTrackEnd"> & {
    reverbNext: number | null;
    reverbCurrent: number | null;
  };
  log(message: string, error?: unknown): void;
}

interface Deck {
  element: HTMLMediaElement;
  index: 0 | 1;
  token: number;
  trackId: string | null;
  source: AttachedSource | null;
}

interface Prepared {
  candidate: DeckCandidate;
  deck: Deck;
  ready: boolean;
  controller: AbortController;
}

const devSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function waitFor(element: HTMLMediaElement, type: string, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener(type, done);
      signal.removeEventListener("abort", aborted);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new DOMException("timeout", "TimeoutError"));
    }, timeoutMs);
    element.addEventListener(type, done);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export class DeckController implements DeckPort {
  private readonly decks: [Deck, Deck];
  private activeIndex: 0 | 1 = 0;
  private graph: AudioGraph | null = null;
  private readonly spectrumListeners = new Map<SpectrumListener, (() => void) | null>();
  private graphFailed = false;
  private context: AudioContext | null = null;
  private volume = 1;
  private tempo: Tempo = { rate: 1, semitones: 0, linked: true };
  private readonly listeners = new Set<(event: DeckEvent) => void>();
  private readonly switchListeners = new Set<(entryId: string) => void>();
  private readonly elementListeners = new Set<(element: HTMLMediaElement) => void>();
  private readonly trackGains = new Map<string, number>();
  private eq: EqState | null = null;
  private reverb = { on: false, level: 0.35 };
  private sleepLevel = 1;
  private candidate: DeckCandidate | null = null;
  private prepared: Prepared | null = null;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private switching = false;
  private outgoing: Deck | null = null;
  private latencies: number[] = [];
  private policy: TransitionPolicy = defaultPolicy;
  private spanResolver: SpanResolver = (_id, durationMs) => ({ startMs: 0, endMs: durationMs });
  private lastFadeMs = GAPLESS_MS;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private resolvePause: (() => void) | null = null;
  private readonly loose = new Set<ReturnType<typeof setTimeout>>();
  private readonly unbind: Array<() => void> = [];
  private disposed = false;
  private maskCancel: (() => void) | null = null;

  constructor(private readonly deps: DecksDeps) {
    this.decks = deps.elements.map((element, index) => {
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      const deck: Deck = { element, index: index as 0 | 1, token: -1, trackId: null, source: null };
      for (const type of ["playing", "pause", "waiting", "canplay", "seeked", "emptied", "timeupdate", "ended", "error", "durationchange"] as const) {
        const handler = () => this.onElementEvent(deck, type);
        element.addEventListener(type, handler);
        this.unbind.push(() => element.removeEventListener(type, handler));
      }
      return deck;
    }) as [Deck, Deck];
  }

  private get active(): Deck {
    return this.decks[this.activeIndex];
  }

  private get idle(): Deck {
    return this.decks[this.activeIndex === 0 ? 1 : 0];
  }

  private ensureGraph(): AudioGraph | null {
    if (this.graph || this.graphFailed) return this.graph;
    try {
      this.context = this.context ?? this.deps.createContext();
      if (!this.context) throw new Error("no AudioContext");
      this.graph = new AudioGraph(this.context, [this.decks[0].element, this.decks[1].element], {
        ...this.deps.graph,
        sources: this.deps.graph.sources ?? devSources,
      });
      this.applyGraphState();
    } catch (error) {
      this.graphFailed = true;
      this.deps.log("audio graph unavailable, playing through the elements", error);
    }
    return this.graph;
  }

  private applyGraphState(): void {
    const graph = this.graph!;
    graph.decks[this.activeIndex].transition.gain.value = 1;
    if (this.eq) graph.shapeEq(this.eq);
    graph.setReverb(this.reverb.on, this.reverb.level);
    graph.setSleepLevel(this.sleepLevel);
    void graph.setPitch(pitchStageActive(this.tempo), this.tempo.semitones);
    for (const deck of this.decks) if (deck.trackId) graph.presetLoudness(deck.index, this.trackGains.get(deck.trackId) ?? 0);
    for (const listener of this.spectrumListeners.keys()) this.spectrumListeners.set(listener, graph.spectrum.subscribe(listener));
  }

  rebuildGraph(): void {
    this.graph?.dispose();
    this.graph = null;
    for (const listener of this.spectrumListeners.keys()) this.spectrumListeners.set(listener, null);
    this.graphFailed = false;
    this.ensureGraph();
  }

  get audioContext(): AudioContext | null {
    return this.context;
  }

  private gainOf(deck: Deck): AudioParam | null {
    return this.graph?.decks[deck.index].transition.gain ?? null;
  }

  // The fallback covers engines without cancelAndHoldAtTime
  private hold(param: AudioParam, now: number, current = param.value): void {
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(now);
      return;
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  }

  private fade(deck: Deck, to: number, ms: number): void {
    const param = this.gainOf(deck);
    if (!param || !this.context) return;
    const now = this.context.currentTime;
    const from = param.value;
    this.hold(param, now, from);
    param.setValueCurveAtTime(raisedCosine(from, to), now, ms / 1000);
  }

  async load(load: DeckLoad): Promise<void> {
    this.cancelTransition(true);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.resolvePause?.();
    this.resolvePause = null;
    const deck = this.active;
    const previous = deck.source;
    deck.token = load.token;
    deck.trackId = load.trackId;
    deck.source = load.source;
    const graph = this.ensureGraph();
    graph?.resume();
    const outParam = this.gainOf(deck);
    if (outParam && !deck.element.paused && outParam.value > 0.01) {
      this.fade(deck, 0, PLAIN_TAIL_MS);
      await new Promise<void>((resolve) => this.later(resolve, PLAIN_TAIL_MS));
      if (deck.token !== load.token || this.disposed) {
        if (previous && previous !== load.source) previous.release();
        return;
      }
    }
    graph?.presetLoudness(deck.index, this.trackGains.get(load.trackId) ?? 0);
    const param = this.gainOf(deck);
    if (param && this.context) {
      param.cancelScheduledValues(this.context.currentTime);
      param.setValueAtTime(0, this.context.currentTime);
    }
    const element = deck.element;
    // The same file again (replaying the current track): no new `playing` event follows, so it is raised below
    const sameSource = element.src === load.source.url;
    const wasPlaying = sameSource && !element.paused;
    if (!sameSource) element.src = load.source.url;
    if (previous && previous !== load.source) previous.release();
    this.applyTempo(element, load.tempo);
    element.volume = this.volume;
    const seekTo = load.positionMs / 1000;
    if (seekTo > 0 || sameSource) {
      if (sameSource || element.readyState >= 1) element.currentTime = seekTo;
      else element.addEventListener("loadedmetadata", () => deck.token === load.token && (element.currentTime = seekTo), { once: true });
    }
    if (!load.play) return;
    await element.play();
    if (wasPlaying && deck.token === load.token) this.onElementEvent(deck, "playing");
  }

  async pause(): Promise<void> {
    const decks = this.switching && this.outgoing ? [this.active, this.outgoing] : [this.active];
    if (this.switching) this.cancelTransition(false);
    for (const deck of decks) this.fade(deck, 0, FADE_MS);
    if (!this.graph) {
      for (const deck of decks) deck.element.pause();
      return;
    }
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    await new Promise<void>((resolve) => {
      this.resolvePause = resolve;
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null;
        this.resolvePause = null;
        for (const deck of decks) deck.element.pause();
        resolve();
      }, FADE_MS);
    });
  }

  async resume(): Promise<void> {
    const deck = this.active;
    this.graph?.resume();
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
      this.resolvePause?.();
      this.resolvePause = null;
      // The element never paused, so no `playing` event follows: raise it here, or the engine waits in "loading"
      this.onElementEvent(deck, "playing");
      return;
    }
    await deck.element.play();
  }

  seek(positionMs: number): void {
    const deck = this.active;
    if (this.switching && this.outgoing) this.cancelTransition(true);
    deck.element.currentTime = positionMs / 1000;
  }

  reset(): void {
    this.cancelTransition(true);
    const deck = this.active;
    deck.element.pause();
    deck.element.removeAttribute("src");
    deck.element.load();
    deck.source?.release();
    deck.source = null;
    deck.trackId = null;
    deck.token = -1;
  }

  holds(token: number): boolean {
    return this.active.token === token && !this.active.element.error;
  }

  hasError(): boolean {
    return Boolean(this.active.element.error);
  }

  positionMs(): number {
    return this.active.element.currentTime * 1000;
  }

  audioTime(): { nowMs: number; latencyMs: number } | null {
    const context = this.context;
    if (!this.graph || context?.state !== "running") return null;
    // currentTime stands still between render callbacks; the output stamp plus the time since runs smoothly
    const stamp = context.getOutputTimestamp();
    const nowMs = stamp.performanceTime ? (stamp.contextTime ?? 0) * 1000 + performance.now() - stamp.performanceTime : context.currentTime * 1000;
    // the shifter holds back a frame less its hop: measured at the output, what the listener hears is that much later
    const shifted = pitchStageActive(this.tempo) ? (PV_FRAME - PV_HOP) / context.sampleRate : 0;
    return { nowMs, latencyMs: (context.baseLatency + context.outputLatency + shifted) * 1000 };
  }

  setVolume(gain: number): void {
    this.volume = Math.min(1, Math.max(0, gain));
    for (const deck of this.decks) deck.element.volume = this.volume;
  }

  setTempo(tempo: Tempo): void {
    this.tempo = tempo;
    this.applyTempo(this.active.element, tempo);
    const graph = this.graph;
    if (graph) void graph.setPitch(pitchStageActive(tempo), tempo.semitones);
    this.rearm();
  }

  setReverb(on: boolean, level: number): void {
    this.soundBus.setReverb(on, level);
  }

  private applyTempo(element: HTMLMediaElement, tempo: Tempo): void {
    element.playbackRate = tempo.rate;
    element.preservesPitch = !tempo.linked;
  }

  swapSource(token: number, source: AttachedSource): void {
    const deck = this.active;
    if (deck.token !== token) return;
    const element = deck.element;
    const at = element.currentTime;
    const wasPlaying = !element.paused;
    deck.source = source;
    element.src = source.url;
    element.addEventListener(
      "loadedmetadata",
      () => {
        element.currentTime = at;
        if (wasPlaying) void element.play().catch(() => undefined);
      },
      { once: true },
    );
  }

  on(listener: (event: DeckEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onSwitch(listener: (entryId: string) => void): () => void {
    this.switchListeners.add(listener);
    return () => this.switchListeners.delete(listener);
  }

  claim(token: number): void {
    this.active.token = token;
  }

  readonly clock = {
    positionMs: () => this.positionMs(),
    activeElement: () => this.active.element,
    onActiveElementChange: (listener: (element: HTMLMediaElement) => void) => {
      this.elementListeners.add(listener);
      return () => this.elementListeners.delete(listener);
    },
  };

  readonly soundBus = {
    shapeEq: (state: EqState, rampSeconds?: number) => {
      this.eq = state;
      this.graph?.shapeEq(state, rampSeconds);
    },
    setTrackGainDb: (trackId: string, db: number) => {
      this.trackGains.set(trackId, db);
      for (const deck of this.decks) if (deck.trackId === trackId) this.graph?.setLoudness(deck.index, db);
    },
    analyser: () => this.graph?.analyser ?? null,
    subscribeSpectrum: (listener: SpectrumListener) => {
      this.spectrumListeners.set(listener, this.graph?.spectrum.subscribe(listener) ?? null);
      return () => {
        this.spectrumListeners.get(listener)?.();
        this.spectrumListeners.delete(listener);
      };
    },
    setSleepLevel: (multiplier: number) => {
      this.sleepLevel = multiplier;
      this.graph?.setSleepLevel(multiplier);
    },
    seekMasked: (positionMs: number) => this.seekMasked(positionMs),
    setReverb: (on: boolean, level: number) => {
      this.reverb = { on, level };
      this.graph?.setReverb(on, level);
    },
    currentFadeMs: () => this.lastFadeMs,
    pitchAvailable: () => this.graph?.pitchAvailable ?? true,
  };

  private later(action: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.loose.delete(timer);
      action();
    }, ms);
    this.loose.add(timer);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discardPrepared();
    this.maskCancel?.();
    for (const timer of [this.armTimer, this.finishTimer, this.pauseTimer, ...this.loose]) if (timer) clearTimeout(timer);
    this.armTimer = this.finishTimer = this.pauseTimer = null;
    this.loose.clear();
    this.resolvePause?.();
    this.resolvePause = null;
    for (const stop of this.unbind) stop();
    this.unbind.length = 0;
    for (const deck of this.decks) {
      deck.element.pause();
      deck.element.removeAttribute("src");
      deck.element.load();
      deck.source?.release();
      deck.source = null;
      deck.trackId = null;
      deck.token = -1;
    }
    this.listeners.clear();
    this.switchListeners.clear();
    this.elementListeners.clear();
    this.graph?.dispose();
    this.graph = null;
    void this.context?.close?.().catch(() => undefined);
    this.context = null;
    this.graphFailed = true;
  }

  private seekMasked(positionMs: number): void {
    const graph = this.graph;
    if (!graph) return this.seek(positionMs);
    this.maskCancel?.();
    graph.mask(true);
    const element = this.active.element;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      element.removeEventListener("seeked", up);
      graph.mask(false);
    };
    this.maskCancel = () => {
      done = true;
      element.removeEventListener("seeked", up);
      for (const timer of timers) clearTimeout(timer);
      this.maskCancel = null;
    };
    timers.push(
      setTimeout(() => {
        element.addEventListener("seeked", up, { once: true });
        timers.push(setTimeout(up, MASK_FALLBACK_MS));
        element.currentTime = positionMs / 1000;
      }, 8),
    );
  }

  setPolicy(policy: TransitionPolicy | null): void {
    this.policy = policy ?? defaultPolicy;
    this.rearm();
  }

  setSpanResolver(resolver: SpanResolver | null): void {
    this.spanResolver = resolver ?? ((_id, durationMs) => ({ startMs: 0, endMs: durationMs }));
    this.rearm();
  }

  private onElementEvent(deck: Deck, type: DeckEvent["type"]): void {
    if (deck !== this.active) return;
    const element = deck.element;
    if (type === "ended" && this.prepared?.ready && !this.switching) {
      this.startSwitch("plain", 0);
      return;
    }
    if (type === "playing" && !this.switching) this.fade(deck, 1, FADE_MS);
    if (type === "timeupdate" || type === "seeked") this.maybePrepare();
    if (type === "timeupdate" || type === "seeked") this.rearm();
    const event: DeckEvent = {
      type,
      token: deck.token,
      positionMs: element.currentTime * 1000,
      durationMs: Number.isFinite(element.duration) ? element.duration * 1000 : 0,
      enoughData: element.readyState >= 3,
      ...(type === "error" ? { error: { code: element.error?.code ?? 0 } } : {}),
    };
    for (const listener of [...this.listeners]) listener(event);
  }

  setCandidate(candidate: DeckCandidate | null): void {
    if (this.candidate?.entryId === candidate?.entryId) {
      this.candidate = candidate;
      return;
    }
    this.candidate = candidate;
    if (this.prepared && this.prepared.candidate.entryId !== candidate?.entryId) this.discardPrepared();
    this.maybePrepare();
  }

  private spanOf(deck: Deck): Span {
    const durationMs = Number.isFinite(deck.element.duration) ? deck.element.duration * 1000 : 0;
    return this.spanResolver(deck.trackId ?? "", durationMs);
  }

  private remainingWallMs(): number {
    const deck = this.active;
    const span = this.spanOf(deck);
    return (span.endMs - deck.element.currentTime * 1000) / (deck.element.playbackRate || 1);
  }

  private maybePrepare(): void {
    const candidate = this.candidate;
    if (!candidate || this.prepared || this.switching || !this.graph) return;
    const fadeMs = this.deps.transitionContext().crossfadeSeconds * 1000;
    if (this.remainingWallMs() >= fadeMs + PREPARE_LEAD_MS) return;
    void this.prepare(candidate);
  }

  private async prepare(candidate: DeckCandidate): Promise<void> {
    const controller = new AbortController();
    const deck = this.idle;
    const prepared: Prepared = { candidate, deck, ready: false, controller };
    this.prepared = prepared;
    try {
      if (!(await this.deps.isFullyCached(candidate.trackId))) {
        if (this.prepared === prepared) this.prepared = null;
        return;
      }
      if (controller.signal.aborted) return;
      const element = deck.element;
      deck.trackId = candidate.trackId;
      deck.token = -1;
      this.applyTempo(element, candidate.tempo);
      element.volume = this.volume;
      this.graph?.presetLoudness(deck.index, this.trackGains.get(candidate.trackId) ?? 0);
      const gain = this.gainOf(deck);
      if (gain && this.context) {
        gain.cancelScheduledValues(this.context.currentTime);
        gain.setValueAtTime(0, this.context.currentTime);
      }
      const ready = waitFor(element, "canplaythrough", controller.signal, PREPARE_CAP_MS);
      element.src = this.deps.cacheUrl(candidate.trackId);
      await ready;
      const start = this.spanResolver(candidate.trackId, element.duration * 1000).startMs;
      const seeked = waitFor(element, "seeked", controller.signal, PREPARE_CAP_MS);
      element.currentTime = start / 1000;
      await seeked;
      prepared.ready = true;
      this.rearm();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.deps.log("deck preparation failed", error);
      void this.deps.dropCached(candidate.trackId);
      if (this.prepared === prepared) this.prepared = null;
    }
  }

  private discardPrepared(): void {
    const prepared = this.prepared;
    if (!prepared) return;
    this.prepared = null;
    prepared.controller.abort();
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
  }

  get lookaheadMs(): number {
    if (this.latencies.length === 0) return LOOKAHEAD_START_MS;
    const average = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
    return Math.min(LOOKAHEAD_MAX_MS, Math.max(0, average));
  }

  private rearm(): void {
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
    const prepared = this.prepared;
    if (!prepared?.ready || this.switching) return;
    const active = this.active;
    const rate = active.element.playbackRate || 1;
    const context = this.deps.transitionContext();
    const plan = this.policy({
      current: this.spanOf(active),
      next: this.spanOf(prepared.deck),
      rate,
      crossfadeSeconds: context.crossfadeSeconds,
      nextReady: true,
      albumInOrder: context.albumInOrder,
      tempo: { current: this.tempo, next: prepared.candidate.tempo },
      reverb: { current: context.reverbCurrent, next: context.reverbNext },
      repeat: context.repeat,
      abLoop: context.abLoop,
      sleepAtTrackEnd: context.sleepAtTrackEnd,
    });
    if (plan.kind === "none") return;
    const waitMs = (plan.startAtMediaMs - active.element.currentTime * 1000) / rate - this.lookaheadMs;
    this.armTimer = setTimeout(
      () => {
        this.armTimer = null;
        this.startSwitch(plan.kind === "none" ? "plain" : plan.kind, plan.fadeMs);
      },
      Math.max(0, waitMs),
    );
  }

  switchNow(entryId: string, token: number): boolean {
    if (!this.prepared?.ready || this.prepared.candidate.entryId !== entryId || this.switching) return false;
    this.startSwitch("crossfade", MANUAL_SKIP_MS, token);
    return true;
  }

  private startSwitch(kind: "crossfade" | "gapless" | "plain", fadeMs: number, token?: number): void {
    const prepared = this.prepared;
    if (!prepared?.ready || this.switching || !this.context) return;
    this.prepared = null;
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
    const outgoing = this.active;
    const incoming = prepared.deck;
    const started = performance.now();
    void incoming.element.play().then(
      () => {
        this.latencies = [...this.latencies, performance.now() - started].slice(-5);
      },
      (error: unknown) => {
        if ((error as { name?: string })?.name === "NotAllowedError") this.autoplayBlocked(outgoing, incoming);
      },
    );
    const now = this.context.currentTime;
    const outParam = this.gainOf(outgoing)!;
    const inParam = this.gainOf(incoming)!;
    const envelope = kind === "gapless" ? GAPLESS_MS : kind === "plain" ? 0 : fadeMs;
    this.lastFadeMs = Math.max(envelope, kind === "plain" ? 20 : envelope);
    for (const param of [outParam, inParam]) this.hold(param, now);
    if (kind === "plain") {
      inParam.setValueAtTime(1, now);
      const spanEnd = this.spanOf(outgoing).endMs;
      const realEnd = Number.isFinite(outgoing.element.duration) ? outgoing.element.duration * 1000 : spanEnd;
      if (spanEnd < realEnd - 1) outParam.setValueCurveAtTime(raisedCosine(outParam.value, 0), now, PLAIN_TAIL_MS / 1000);
    } else {
      const { fadeIn, fadeOut } = equalPower();
      inParam.setValueCurveAtTime(fadeIn, now, envelope / 1000);
      outParam.setValueCurveAtTime(fadeOut, now, envelope / 1000);
    }
    this.switching = true;
    this.outgoing = outgoing;
    this.activeIndex = incoming.index;
    incoming.token = token ?? outgoing.token;
    for (const listener of this.elementListeners) listener(incoming.element);
    if (token === undefined) for (const listener of this.switchListeners) listener(prepared.candidate.entryId);
    this.finishTimer = setTimeout(() => this.finishSwitch(), envelope + FINISH_EXTRA_MS);
  }

  private finishSwitch(): void {
    this.finishTimer = null;
    this.outgoing?.element.pause();
    this.outgoing = null;
    this.switching = false;
    this.maybePrepare();
  }

  private cancelTransition(fadeOutgoing: boolean): void {
    this.discardPrepared();
    if (!this.switching) return;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    const outgoing = this.outgoing;
    this.switching = false;
    this.outgoing = null;
    if (!outgoing || !this.context) return;
    this.fade(this.active, 1, PLAIN_TAIL_MS);
    if (fadeOutgoing) {
      this.fade(outgoing, 0, PLAIN_TAIL_MS);
      this.later(() => outgoing.element.pause(), PLAIN_TAIL_MS);
    } else {
      outgoing.element.pause();
    }
  }

  private autoplayBlocked(outgoing: Deck, incoming: Deck): void {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    this.switching = false;
    this.outgoing = null;
    this.activeIndex = outgoing.index;
    const now = this.context?.currentTime ?? 0;
    for (const deck of [outgoing, incoming]) {
      const param = this.gainOf(deck);
      if (param) this.hold(param, now);
    }
    const event: DeckEvent = { type: "pause", token: outgoing.token, positionMs: outgoing.element.currentTime * 1000, durationMs: 0, enoughData: true };
    outgoing.element.pause();
    for (const listener of this.listeners) listener({ ...event });
  }
}
