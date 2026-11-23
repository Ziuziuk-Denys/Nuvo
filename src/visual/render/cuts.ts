const SHOT_MIN_MS = 450;

export interface Cuts {
  cuts: number;
  cutAgeMs: number;
  shots: number;
  shotAgeMs: number;
}

export function createCuts() {
  let cuts = 0;
  let cutAtMs = -Infinity;
  let shots = 0;
  let shotAtMs = -Infinity;

  return {
    step(timeMs: number, hit: boolean): Cuts {
      // after a seek back or a song change the last hit lies in the future
      if (cutAtMs > timeMs) cutAtMs = -Infinity;
      if (shotAtMs > timeMs) shotAtMs = -Infinity;
      if (hit) {
        cuts += 1;
        cutAtMs = timeMs;
        if (timeMs - shotAtMs >= SHOT_MIN_MS) {
          shots += 1;
          shotAtMs = timeMs;
        }
      }
      return { cuts, cutAgeMs: timeMs - cutAtMs, shots, shotAgeMs: timeMs - shotAtMs };
    },
    reset(): void {
      cuts = 0;
      cutAtMs = -Infinity;
      shots = 0;
      shotAtMs = -Infinity;
    },
  };
}
