import { activeLine, leadStarts } from "./timing";
import type { Line } from "./types";
import { LyricsClock, type AudioTime } from "./view";

export interface AudioPort {
  positionMs(): number;
  playing(): boolean;
  rate?(): number;
  audioTime?(): AudioTime | null;
  subscribe(listener: () => void): () => void;
}

export interface TrackerDeps {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  now(): number;
  onLine(index: number | null): void;
}

export class LineTracker {
  readonly clock: LyricsClock;
  private lines: Line[] = [];
  private leads: number[] = [];
  private timed = false;
  private durationMs = 0;
  private current: number | null = null;
  private audio: AudioPort | null = null;
  private unsubscribe: (() => void) | null = null;
  private frame: number | null = null;
  private observers = 0;
  private visibilityOff: (() => void) | null = null;
  private readonly frameListeners = new Set<() => void>();

  constructor(private readonly deps: TrackerDeps) {
    this.clock = new LyricsClock(deps.now, () => this.audio?.audioTime?.() ?? null);
  }

  onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener);
    listener();
    return () => this.frameListeners.delete(listener);
  }

  observe(): () => void {
    this.observers += 1;
    this.reportClock();
    this.sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.observers -= 1;
      this.sync();
    };
  }

  connect(audio: AudioPort): void {
    this.unsubscribe?.();
    this.audio = audio;
    this.unsubscribe = audio.subscribe(() => {
      this.evaluate();
      this.sync();
    });
    this.visibilityOff?.();
    const onVisibility = () => {
      this.evaluate();
      this.sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.visibilityOff = () => document.removeEventListener("visibilitychange", onVisibility);
    this.sync();
  }

  setLines(lines: Line[], timed: boolean, durationMs: number): number | null {
    this.lines = lines;
    this.leads = leadStarts(lines);
    this.timed = timed;
    this.durationMs = durationMs;
    this.current = timed && this.audio ? activeLine(lines, this.leads, this.audio.positionMs()) : null;
    this.reportClock();
    this.sync();
    return this.current;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.visibilityOff?.();
    this.visibilityOff = null;
    this.audio = null;
    if (this.frame !== null) this.deps.cancelFrame(this.frame);
    this.frame = null;
  }

  private sync(): void {
    if (this.timed && this.observers > 0 && !document.hidden && this.audio?.playing() === true) {
      this.frame ??= this.deps.requestFrame(this.tick);
      return;
    }
    if (this.frame === null) return;
    this.deps.cancelFrame(this.frame);
    this.frame = null;
    this.evaluate();
  }

  private readonly tick = (): void => {
    this.frame = null;
    this.evaluate();
    this.sync();
  };

  private rate(audio: AudioPort): number {
    const rate = audio.rate?.() ?? 1;
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  // a paused, restored track never plays or seeks, so the view clock would stay at 0 without this
  private reportClock(): number | null {
    if (!this.audio) return null;
    const positionMs = this.audio.positionMs();
    this.clock.report(positionMs, this.audio.playing(), this.durationMs, this.rate(this.audio));
    return positionMs;
  }

  private evaluate(): void {
    const positionMs = this.reportClock();
    if (positionMs === null) return;
    const line = this.timed ? activeLine(this.lines, this.leads, positionMs) : null;
    if (line !== this.current) {
      this.current = line;
      this.deps.onLine(line);
    }
    for (const listener of this.frameListeners) listener();
  }
}
