import type { LyricsEngine } from "./engine";

let current: LyricsEngine | null = null;

export function setLyrics(engine: LyricsEngine): void {
  if (current && current !== engine) current.dispose();
  current = engine;
}

export function lyrics(): LyricsEngine {
  if (!current) throw new Error("the lyrics engine has not started");
  return current;
}

export { LyricsEngine, type LyricsDeps } from "./engine";
export type { AudioPort } from "./tracker";
export { FRAME_MS } from "./timing";
export { wordProgress, pinTopOnNewTrack, releaseTopPin, type PinInput, type ReleaseInput } from "./view";
export { CORE_URL, putOffset, putOffsets, readLyricsStream, streamUrl } from "./stream";
export { migrateLegacyLyrics } from "./migrate";
export { romanizeKana, romanizerFor } from "./romanize";
export type { Line, LyricsState, LyricsStatus, RawLyrics, StreamEvent, Version, Word } from "./types";
