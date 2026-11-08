/** Timing helpers for views: the word-fill clock, word progress and the new-song scroll pin. */
import type { Status } from "@/engine/types";

/** A reported position further than this from the estimate re-anchors the clock. */
export const RESYNC_MS = 60;
/** A smaller gap is closed by this share per report: position jitter never shows, a real drift is gone within a second. */
const SLEW = 0.05;
/** A position under this counts as the start of a song. */
export const FRESH_START_MS = 2000;
export const PIN_LIMIT_MS = 8000;

/** A running audio clock: `nowMs` ticks with the samples, `latencyMs` is how long a sample takes to reach the ear. */
export interface AudioTime {
  nowMs: number;
  latencyMs: number;
}

/** Maps audio time to the song position that is being heard; wall time stands in while no audio clock runs. */
export class LyricsClock {
  private anchorMs = 0;
  private anchorTime = 0;
  private onAudio = false;
  private playing = false;
  private durationMs = 0;
  private rate = 1;

  constructor(
    private readonly now: () => number,
    private readonly audioTime: () => AudioTime | null = () => null,
  ) {}

  /** `rate` is the playback speed; the clock advances rate ms per audio ms. */
  report(positionMs: number, playing: boolean, durationMs: number, rate = 1): void {
    const audio = this.audioTime();
    const time = audio?.nowMs ?? this.now();
    this.durationMs = durationMs;
    const gap = positionMs - this.estimate(time);
    if (!playing || playing !== this.playing || rate !== this.rate || (audio !== null) !== this.onAudio || Math.abs(gap) > RESYNC_MS) {
      this.anchorMs = positionMs;
      this.anchorTime = time;
      this.onAudio = audio !== null;
    } else {
      this.anchorMs += gap * SLEW;
    }
    this.rate = rate;
    this.playing = playing;
  }

  read(): { atMs: number; playing: boolean } {
    const audio = this.audioTime();
    const sameBase = (audio !== null) === this.onAudio;
    const atMs = sameBase ? this.estimate(audio?.nowMs ?? this.now()) : this.anchorMs;
    return { atMs: Math.max(0, atMs - (audio?.latencyMs ?? 0) * this.rate), playing: this.playing };
  }

  private estimate(time: number): number {
    if (!this.playing) return this.anchorMs;
    const ms = Math.max(0, this.anchorMs + (time - this.anchorTime) * this.rate);
    return this.durationMs > 0 ? Math.min(ms, this.durationMs) : ms;
  }
}

/** 0 to 100; a word of zero length jumps from 0 to 100 at its start. */
export function wordProgress(word: { fromMs: number; toMs: number }, atMs: number): number {
  if (atMs < word.fromMs) return 0;
  if (atMs >= word.toMs) return 100;
  return Math.min(100, Math.max(0, ((atMs - word.fromMs) / (word.toMs - word.fromMs)) * 100));
}

export interface PinInput {
  playerStatus: Status;
  positionMs: number;
}

/** On a new track: pin the view to the top unless the song was opened in the middle. */
export function pinTopOnNewTrack(state: PinInput): boolean {
  return state.playerStatus === "idle" || state.playerStatus === "loading" || state.positionMs < FRESH_START_MS;
}

export interface ReleaseInput {
  playerStatus: Status;
  audioPaused: boolean;
  positionMs: number;
  pinnedForMs: number;
}

/** The audio may still report the previous song's position; release only once the new one really plays. */
export function releaseTopPin(state: ReleaseInput): boolean {
  const freshlyPlaying = state.playerStatus === "playing" && !state.audioPaused && state.positionMs < FRESH_START_MS;
  return freshlyPlaying || state.pinnedForMs >= PIN_LIMIT_MS;
}
