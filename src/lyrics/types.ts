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
  companion: boolean;
  instrumental: boolean;
}

export interface RawLyrics {
  format: string;
  content: string;
}

export interface Candidate {
  provider: string;
  syncLevel: string;
  topPriority?: boolean;
  label?: string;
  quality: { total: number };
  lyrics: RawLyrics;
}

export interface Version {
  provider: string;
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
  trackId: string | null;
  status: LyricsStatus;
  lines: Line[];
  plainText: string | null;
  synced: boolean;
  wordTimed: boolean;
  versions: Version[];
  activeVersion: string | null;
  offsetMs: number;
  currentLine: number | null;
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
