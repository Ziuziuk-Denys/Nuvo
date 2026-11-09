import type { Track } from "@/engine/types";
import { clampOffset, shiftLines } from "./timing";
import { LineTracker, type AudioPort } from "./tracker";
import { EMPTY_STATE, type LyricsState, type LyricsStatus, type StreamEvent } from "./types";
import { addEntry, toEntry, toVersion, type Entry } from "./versions";

export const CACHE_SIZE = 20;
export const PREFETCH_GIVE_UP_MS = 8000;
/** A held nudge button makes one daemon write. */
export const OFFSET_SAVE_DELAY_MS = 400;

interface Known {
  entries: Entry[];
  chosen: string | null;
  outcome: "ready" | "instrumental" | "none";
  offsetMs: number;
  offsetSet: boolean;
  arrivals: number;
}

export interface LyricsDeps {
  stream(track: Track, signal: AbortSignal): AsyncIterable<StreamEvent>;
  saveOffset(trackId: string, offsetMs: number): Promise<void>;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  now(): number;
}

const blank = (): Known => ({ entries: [], chosen: null, outcome: "none", offsetMs: 0, offsetSet: false, arrivals: 0 });

function fold(known: Known, event: StreamEvent, trackMs: number): boolean {
  if (event.type === "metadata" && !known.offsetSet) known.offsetMs = clampOffset(event.offsetMs ?? 0);
  if (event.type === "provider") {
    const entry = toEntry(event, known.arrivals, trackMs);
    known.arrivals += 1;
    if (entry) known.entries = addEntry(known.entries, entry);
  }
  if (event.type !== "done") return false;
  if (known.entries.length > 0) known.outcome = "ready";
  else known.outcome = event.status === "instrumental" ? "instrumental" : "none";
  return true;
}

export class LyricsEngine {
  private state: LyricsState = EMPTY_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly known = new Map<string, Known>();
  private readonly prefetching = new Map<string, { run: Promise<void>; controller: AbortController }>();
  private readonly gaveUp = new Set<string>();
  private readonly tracker: LineTracker;
  private track: Track | null = null;
  private live: Known | null = null;
  private controller: AbortController | null = null;
  private pendingOffset: { trackId: string; offsetMs: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly deps: LyricsDeps) {
    this.tracker = new LineTracker({
      requestFrame: deps.requestFrame,
      cancelFrame: deps.cancelFrame,
      now: deps.now,
      onLine: (currentLine) => this.set({ currentLine }),
    });
  }

  getState(): LyricsState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const release = this.tracker.observe();
    return () => {
      this.listeners.delete(listener);
      release();
    };
  }

  connectAudio(audio: AudioPort): void {
    this.tracker.connect(audio);
  }

  clock(): { atMs: number; playing: boolean } {
    return this.tracker.clock.read();
  }

  onFrame(listener: () => void): () => void {
    return this.tracker.onFrame(listener);
  }

  async follow(track: Track | null): Promise<void> {
    if (track && track.id === this.track?.id && this.state.status !== "error") return;
    this.flushOffset();
    this.controller?.abort();
    this.controller = null;
    this.track = track;
    this.live = null;
    if (!track) {
      this.tracker.setLines([], false, 0);
      this.set(EMPTY_STATE);
      return;
    }
    const hit = this.recall(track.id);
    if (hit) {
      this.live = hit;
      this.render(track, hit.outcome);
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const known = blank();
    this.live = known;
    this.render(track, "loading");
    const prefetch = this.prefetching.get(track.id);
    if (prefetch) {
      await prefetch.run;
      if (this.controller !== controller) return;
      const fetched = this.recall(track.id);
      if (fetched) {
        this.controller = null;
        this.live = fetched;
        this.render(track, fetched.outcome);
        return;
      }
    }
    await this.stream(track, controller, known);
  }

  async prefetch(track: Track): Promise<void> {
    const streaming = this.track?.id === track.id && this.controller !== null;
    if (this.known.has(track.id) || this.prefetching.has(track.id) || this.gaveUp.has(track.id) || streaming) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      this.gaveUp.add(track.id);
      const oldest = this.gaveUp.values().next().value;
      if (this.gaveUp.size > CACHE_SIZE && oldest !== undefined) this.gaveUp.delete(oldest);
    }, PREFETCH_GIVE_UP_MS);
    const run = this.collect(track, controller.signal);
    this.prefetching.set(track.id, { run, controller });
    try {
      await run;
    } finally {
      clearTimeout(timer);
      this.prefetching.delete(track.id);
    }
  }

  async reload(track: Track): Promise<void> {
    this.known.delete(track.id);
    this.gaveUp.delete(track.id);
    this.prefetching.get(track.id)?.controller.abort();
    if (this.track?.id !== track.id) return;
    this.track = null;
    await this.follow(track);
  }

  chooseVersion(provider: string): void {
    const known = this.live;
    if (!this.track || !known?.entries.some((entry) => entry.candidate.provider === provider)) return;
    known.chosen = provider;
    this.render(this.track, "ready");
  }

  changeOffset(ms: number): void {
    const known = this.live;
    if (!this.track || !known) return;
    const offsetMs = clampOffset(ms);
    if (offsetMs === known.offsetMs) return;
    known.offsetMs = offsetMs;
    known.offsetSet = true;
    this.render(this.track, this.state.status);
    this.scheduleSave(this.track.id, offsetMs);
  }

  nudgeOffset(deltaMs: number): void {
    this.changeOffset((this.live?.offsetMs ?? 0) + deltaMs);
  }

  clearOffset(): void {
    this.changeOffset(0);
  }

  private scheduleSave(trackId: string, offsetMs: number): void {
    if (this.pendingOffset && this.pendingOffset.trackId !== trackId) this.flushOffset();
    if (this.pendingOffset) clearTimeout(this.pendingOffset.timer);
    this.pendingOffset = { trackId, offsetMs, timer: setTimeout(() => this.flushOffset(), OFFSET_SAVE_DELAY_MS) };
  }

  private flushOffset(): void {
    const pending = this.pendingOffset;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOffset = null;
    void this.deps.saveOffset(pending.trackId, pending.offsetMs).catch(() => undefined);
  }

  dispose(): void {
    this.flushOffset();
    this.controller?.abort();
    for (const { controller } of this.prefetching.values()) controller.abort();
    this.tracker.dispose();
    this.listeners.clear();
  }

  private async stream(track: Track, controller: AbortController, known: Known): Promise<void> {
    const current = () => this.controller === controller;
    try {
      for await (const event of this.deps.stream(track, controller.signal)) {
        if (!current()) return;
        if (fold(known, event, track.durationMs)) {
          this.remember(track.id, known);
          this.render(track, known.outcome);
          return;
        }
        this.render(track, known.entries.length > 0 ? "ready" : "loading");
      }
      throw new Error("lyrics stream ended before done");
    } catch {
      if (current() && known.entries.length === 0) this.render(track, "error");
    } finally {
      if (current()) this.controller = null;
    }
  }

  private async collect(track: Track, signal: AbortSignal): Promise<void> {
    const known = blank();
    try {
      for await (const event of this.deps.stream(track, signal)) {
        if (fold(known, event, track.durationMs)) {
          this.remember(track.id, known);
          return;
        }
      }
    } catch {}
  }

  private render(track: Track, status: LyricsStatus): void {
    const known = this.live ?? blank();
    const entry = known.entries.find((candidate) => candidate.candidate.provider === known.chosen) ?? known.entries[0];
    const parsed = entry?.parsed;
    const lines = shiftLines(parsed?.lines ?? [], known.offsetMs);
    const synced = parsed?.synced ?? false;
    const currentLine = this.tracker.setLines(lines, status === "ready" && synced, track.durationMs);
    this.set({
      trackId: track.id,
      status,
      lines,
      plainText: parsed?.plainText ?? null,
      synced,
      wordTimed: parsed?.wordTimed ?? false,
      versions: known.entries.map(toVersion),
      activeVersion: entry?.candidate.provider ?? null,
      offsetMs: known.offsetMs,
      currentLine,
      rawForView: entry?.candidate.lyrics ?? null,
    });
  }

  private recall(trackId: string): Known | null {
    const known = this.known.get(trackId);
    if (!known) return null;
    this.known.delete(trackId);
    this.known.set(trackId, known);
    return known;
  }

  private remember(trackId: string, known: Known): void {
    this.known.delete(trackId);
    this.known.set(trackId, known);
    while (this.known.size > CACHE_SIZE) {
      const oldest = this.known.keys().next().value;
      if (oldest === undefined) break;
      this.known.delete(oldest);
    }
  }

  private set(patch: Partial<LyricsState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
