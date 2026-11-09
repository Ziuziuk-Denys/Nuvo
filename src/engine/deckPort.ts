import type { AttachedSource } from "./sources/resolver";
import type { Tempo } from "./tempo";

export type DeckEventType = "playing" | "pause" | "waiting" | "canplay" | "seeked" | "emptied" | "timeupdate" | "ended" | "error" | "durationchange";

export interface DeckEvent {
  type: DeckEventType;
  token: number;
  positionMs: number;
  durationMs: number;
  enoughData: boolean;
  error?: { code: number; httpStatus?: number };
}

export interface DeckLoad {
  token: number;
  trackId: string;
  source: AttachedSource;
  positionMs: number;
  tempo: Tempo;
  play: boolean;
}

export interface DeckCandidate {
  entryId: string;
  trackId: string;
  tempo: Tempo;
}

export interface DeckPort {
  load(load: DeckLoad): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): void;
  reset(): void;
  holds(token: number): boolean;
  hasError(): boolean;
  positionMs(): number;
  audioTime(): { nowMs: number; latencyMs: number } | null;
  setVolume(gain: number): void;
  setTempo(tempo: Tempo): void;
  setReverb(on: boolean, level: number): void;
  swapSource(token: number, source: AttachedSource): void;
  setCandidate(candidate: DeckCandidate | null): void;
  setSpanResolver?(resolver: ((trackId: string, durationMs: number) => { startMs: number; endMs: number }) | null): void;
  switchNow(entryId: string, token: number): boolean;
  on(listener: (event: DeckEvent) => void): () => void;
  onSwitch(listener: (entryId: string) => void): () => void;
  claim(token: number): void;
  dispose?(): void;
}
