export interface PositionSample {
  positionMs: number;
  sampledAt: number;
  playing: boolean;
  durationMs: number;
}

/** Position between samples: the player sends at most 4 a second, the island draws every frame. */
export function positionAt(sample: PositionSample, now: number): number {
  if (!sample.playing) return sample.positionMs;
  const position = sample.positionMs + Math.max(0, now - sample.sampledAt);
  return sample.durationMs > 0 ? Math.min(position, sample.durationMs) : position;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

/** Index of the line being sung at `positionMs`, or -1 before the first line. */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Milliseconds until the next line starts, or null after the last one. Used to arm one timer. */
export function msUntilNextLine(lines: LyricLine[], positionMs: number): number | null {
  const next = lines[activeLineIndex(lines, positionMs) + 1];
  return next ? Math.max(16, next.timeMs - positionMs) : null;
}

export function formatTime(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
