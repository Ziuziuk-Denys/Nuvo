export interface ClockSample {
  atMs: number;
  playing: boolean;
  stamp: number;
}

const RATE_SPAN_MS = 250;
const MIN_RATE = 0.25;
const MAX_RATE = 4;
// past this the page has stopped sending; the clock runs on alone, but not forever
const FREEWHEEL_MS = 1_000;
// steps back smaller than this are frame jitter between the page and the worker, not a seek
const JITTER_MS = 12;

// follows the newest page sample; runs on alone only while the page is silent, so it never runs ahead of a stuck song
export function createStageClock() {
  let last: ClockSample = { atMs: 0, playing: false, stamp: 0 };
  let anchor: ClockSample | null = null;
  let rate = 1;
  let shown = 0;

  return {
    sample(next: ClockSample): void {
      if (!next.playing || !last.playing || next.atMs < last.atMs) anchor = next;
      else if (anchor && next.stamp - anchor.stamp >= RATE_SPAN_MS) {
        const measured = (next.atMs - anchor.atMs) / (next.stamp - anchor.stamp);
        // a stuck song reads as zero; it is held by the samples themselves, so only real speeds are learned
        if (measured >= MIN_RATE && measured <= MAX_RATE) rate = measured;
        anchor = next;
      }
      anchor ??= next;
      last = next;
    },
    read(stamp: number): { atMs: number; playing: boolean } {
      if (!last.playing) {
        shown = last.atMs;
        return { atMs: last.atMs, playing: false };
      }
      const atMs = last.atMs + Math.min(Math.max(0, stamp - last.stamp), FREEWHEEL_MS) * rate;
      shown = atMs < shown && shown - atMs < JITTER_MS ? shown : atMs;
      return { atMs: shown, playing: true };
    },
  };
}
