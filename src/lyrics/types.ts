/** The lyrics engine's data contract and the daemon's stream events (2.4). */

export type LyricsStatus = "idle" | "loading" | "ready" | "instrumental" | "none" | "error";

export interface Word {
  fromMs: number;
  toMs: number;
  /** Keeps its trailing space, so joining the words gives the line. */
  text: string;
  background: boolean;
}

export interface Line {
  fromMs: number;
  toMs: number;
  text: string;
  words?: Word[];
  /** A backing-vocal line shown with the line before it; never the active line. */
  companion: boolean;
  instrumental: boolean;
}

export interface RawLyrics {
  format: string;
  content: string;
}

/** A daemon candidate, reduced to the fields the engine reads. */
export interface Candidate {
  provider: string;
  syncLevel: string;
  topPriority?: boolean;
  /** A human word chosen by the daemon ("Aligned", "Auto"); absent today. */
  label?: string;
  quality: { total: number };
  lyrics: RawLyrics;
}

export interface Version {
  provider: string;
  /** The daemon's label; null when the view derives one from `syncLevel` (port `versionLabel`). */
  label: string | null;
  syncLevel: string;
  quality: number;
  topPriority: boolean;
}

export type StreamEvent =
  | { type: "metadata"; track: { id: string }; offsetMs?: number }
  | { type: "provider"; provider: string; status: "found" | "not_found" | "error"; syncLevel?: string; candidate?: Candidate; message?: string }
  | { type: "done"; cached: boolean; status?: string };

export interface LyricsState {
  /** A view shows nothing when this differs from the playing track. */
  trackId: string | null;
  status: LyricsStatus;
  /** Timed lines after the offset; empty for plain lyrics. */
  lines: Line[];
  plainText: string | null;
  synced: boolean;
  wordTimed: boolean;
  versions: Version[];
  activeVersion: string | null;
  offsetMs: number;
  currentLine: number | null;
  /** The shown version's raw text, for views that hand it to `@braccato/core`. */
  rawForView: RawLyrics | null;
}

export const EMPTY_STATE: LyricsState = {
  trackId: null,
  status: "idle",
  lines: [],
  plainText: null,
  synced: false,
  wordTimed: false,
  versions: [],
  activeVersion: null,
  offsetMs: 0,
  currentLine: null,
  rawForView: null,
};
