import type { Extractor, Features } from "./features";

const FIRST_STEP_MS = 1000 / 60;
const MAX_STEP_MS = 100;

export interface SongFeatures {
  at(window: Float32Array, atMs: number): Features;
}

// the analysis keeps song time, so a frozen moment returns the same features however often it is drawn
export function createSongFeatures(extractor: Extractor): SongFeatures {
  let lastAt: number | null = null;
  let last: Features | null = null;
  return {
    at(window, atMs) {
      if (last && atMs === lastAt) return last;
      const stepMs = lastAt === null ? FIRST_STEP_MS : Math.min(MAX_STEP_MS, Math.max(0, atMs - lastAt));
      lastAt = atMs;
      last = extractor.step(window, stepMs);
      return last;
    },
  };
}
