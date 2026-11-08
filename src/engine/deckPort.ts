/** What the transport needs from the audio side (two decks, graph, fades). Implemented by `audio/decks.ts`. */
import type { AttachedSource } from "./sources/resolver";
import type { Tempo } from "./tempo";

export type DeckEventType = "playing" | "pause" | "waiting" | "canplay" | "seeked" | "emptied" | "timeupdate" | "ended" | "error" | "durationchange";

export interface DeckEvent {
  type: DeckEventType;
  /** Load token of the start the active deck holds. */
  token: number;
  positionMs: number;
  durationMs: number;
  /** `readyState` is at least HAVE_FUTURE_DATA. */
  enoughData: boolean;
  error?: { code: number; httpStatus?: number };
}

export interface DeckLoad {
  token: number;
  trackId: string;
  source: AttachedSource;
  positionMs: number;
  tempo: Tempo;
  /** Start playing once attached (false for a paused restore that only attaches). */
  play: boolean;
}

/** The next entry the idle deck may prepare. */
export interface DeckCandidate {
  entryId: string;
  trackId: string;
  tempo: Tempo;
}

export interface DeckPort {
  /** Attaches the source on the active deck (the previous source stays until now) and plays. Rejects with `play()`'s DOMException. */
  load(load: DeckLoad): Promise<void>;
  /** 180 ms fade, then the element pauses. */
  pause(): Promise<void>;
  /** 180 ms fade-in. Rejects with `play()`'s DOMException. */
  resume(): Promise<void>;
  seek(positionMs: number): void;
  /** Empties the active element and releases its source (pause during loading, forget session). */
  reset(): void;
  /** The active deck holds this start and has no media error. */
  holds(token: number): boolean;
  hasError(): boolean;
  positionMs(): number;
  /** The output's clock and delay; null while no audio context runs. */
  audioTime(): { nowMs: number; latencyMs: number } | null;
  setVolume(gain: number): void;
  setTempo(tempo: Tempo): void;
  setReverb(on: boolean, level: number): void;
  /** Progressive overflow: swap to the whole file at the same position without a status change. */
  swapSource(token: number, source: AttachedSource): void;
  setCandidate(candidate: DeckCandidate | null): void;
  /** The part of each track that plays; null for whole tracks. The prepared deck starts at its start and the switch lands at its end. */
  setSpanResolver?(resolver: ((trackId: string, durationMs: number) => { startMs: number; endMs: number }) | null): void;
  /** Manual next to the prepared entry: 120 ms crossfade, true when it happened. */
  switchNow(entryId: string, token: number): boolean;
  on(listener: (event: DeckEvent) => void): () => void;
  /** The prepared deck took over by itself (natural switch); the engine answers with `claim`. */
  onSwitch(listener: (entryId: string) => void): () => void;
  claim(token: number): void;
  /** Releases timers, listeners, sources and audio nodes; the port is unusable afterwards. */
  dispose?(): void;
}
