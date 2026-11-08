export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const EQ_Q = 1.1;

export type EqGains = number[];

export interface EqBand {
  type: BiquadFilterType;
  frequency: number;
  q: number;
}

/** Shelves at the ends, peaking filters between, so the curve can tilt as well as bend. */
export function eqBands(): EqBand[] {
  return EQ_FREQUENCIES.map((frequency, index) => ({
    type: index === 0 ? "lowshelf" : index === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking",
    frequency,
    q: EQ_Q,
  }));
}

export const FLAT: EqGains = EQ_FREQUENCIES.map(() => 0);

export type BuiltInPreset =
  "flat" | "bass_boost" | "bass_reducer" | "vocal" | "treble_boost" | "loudness" | "electronic" | "rock" | "hip_hop" | "acoustic" | "podcast" | "night";

export const BUILT_IN_PRESETS: Record<BuiltInPreset, EqGains> = {
  flat: FLAT,
  bass_boost: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  bass_reducer: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  treble_boost: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  loudness: [5, 4, 2, 0, -1, 0, 0, 1, 3, 4],
  electronic: [5, 4, 1, 0, -2, 1, 0, 2, 4, 5],
  rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  hip_hop: [5, 4, 2, 3, -1, -1, 1, 0, 2, 3],
  acoustic: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1],
  podcast: [-4, -3, -1, 1, 3, 4, 3, 1, -1, -3],
  night: [2, 2, 1, 0, 0, 0, -1, -3, -4, -5],
};

export function clampGain(db: number): number {
  return Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, db));
}

/** Snap to 0.5 dB normally, 0.1 dB when fine-tuning. */
export function snapGain(db: number, fine = false): number {
  const step = fine ? 0.1 : 0.5;
  let result = clampGain(Math.round(db / step) * step);
  if (fine) result = Math.round(result * 10) / 10;
  return Object.is(result, -0) ? 0 : result;
}

// Band centres plus a log grid, so overlapping boosts and the shelf plateaus past 31 Hz and 16 kHz count
const PREAMP_PROBE = new Float32Array([...EQ_FREQUENCIES, ...logFrequencies(64)]);

/** Lowers the preamp by the peak of the combined response minus 1 dB so a boosted curve cannot clip. */
export function autoPreamp(gains: EqGains): number {
  const peak = Math.max(0, ...responseDb(gains, PREAMP_PROBE));
  return peak > 1 ? -(peak - 1) : 0;
}

/**
 * "Sculpt": dragging empty space at frequency `hz` by `deltaDb` bends the two nearest bands,
 * each in proportion to how close it is (log-frequency distance).
 */
export function sculpt(gains: EqGains, hz: number, deltaDb: number): EqGains {
  if (!Number.isFinite(hz) || !Number.isFinite(deltaDb)) return gains;
  const position = Math.log2(hz);
  const logs = EQ_FREQUENCIES.map((f) => Math.log2(f));
  let right = logs.findIndex((l) => l >= position);
  if (right === -1) right = logs.length - 1;
  const left = Math.max(0, right === 0 ? 0 : right - 1);
  const next = [...gains];
  if (left === right || position <= logs[0] || position >= logs[logs.length - 1]) {
    next[right] = clampGain(next[right] + deltaDb);
    return next;
  }
  const span = logs[right] - logs[left];
  const towardRight = (position - logs[left]) / span;
  next[left] = clampGain(next[left] + deltaDb * (1 - towardRight));
  next[right] = clampGain(next[right] + deltaDb * towardRight);
  return next;
}

/** Log-spaced frequencies for drawing the response curve and the spectrum. */
export function logFrequencies(count: number, min = 20, max = 20000): Float32Array {
  const out = new Float32Array(count);
  const ratio = Math.log(max / min);
  for (let i = 0; i < count; i++) out[i] = min * Math.exp((ratio * i) / (count - 1));
  return out;
}

/**
 * Magnitude response of the ten bands in dB, using the same biquad formulas as the
 * Web Audio specification (shelves ignore Q). Computed from target gains rather than read from
 * the live graph, whose parameters ramp and would draw one step behind.
 */
export function responseDb(gains: EqGains, frequencies: Float32Array, sampleRate = 48000): Float32Array {
  const out = new Float32Array(frequencies.length);
  eqBands().forEach((band, index) => {
    const gain = gains[index] ?? 0;
    if (gain === 0) return;
    const a = 10 ** (gain / 40);
    const w0 = (2 * Math.PI * band.frequency) / sampleRate;
    const cos0 = Math.cos(w0);
    const sin0 = Math.sin(w0);
    let b: [number, number, number];
    let d: [number, number, number];
    if (band.type === "peaking") {
      const alpha = sin0 / (2 * band.q);
      b = [1 + alpha * a, -2 * cos0, 1 - alpha * a];
      d = [1 + alpha / a, -2 * cos0, 1 - alpha / a];
    } else {
      const k = 2 * Math.sqrt(a) * (sin0 / 2) * Math.SQRT2;
      const sign = band.type === "lowshelf" ? 1 : -1;
      b = [a * (a + 1 - sign * (a - 1) * cos0 + k), sign * 2 * a * (a - 1 - sign * (a + 1) * cos0), a * (a + 1 - sign * (a - 1) * cos0 - k)];
      d = [a + 1 + sign * (a - 1) * cos0 + k, -sign * 2 * (a - 1 + sign * (a + 1) * cos0), a + 1 + sign * (a - 1) * cos0 - k];
    }
    for (let i = 0; i < frequencies.length; i++) {
      const w = (2 * Math.PI * frequencies[i]) / sampleRate;
      const cos1 = Math.cos(w);
      const cos2 = Math.cos(2 * w);
      const sin1 = Math.sin(w);
      const sin2 = Math.sin(2 * w);
      const numerator = (b[0] + b[1] * cos1 + b[2] * cos2) ** 2 + (b[1] * sin1 + b[2] * sin2) ** 2;
      const denominator = (d[0] + d[1] * cos1 + d[2] * cos2) ** 2 + (d[1] * sin1 + d[2] * sin2) ** 2;
      out[i] += 10 * Math.log10(numerator / denominator);
    }
  });
  return out;
}

/** Profile lookup order: track beats artist beats global. */
export function resolveProfile<T>(trackId: string | null, artist: string | null, byTrack: Record<string, T>, byArtist: Record<string, T>, global: T): T {
  if (trackId && byTrack[trackId] !== undefined) return byTrack[trackId];
  if (artist && byArtist[artist.toLowerCase()] !== undefined) return byArtist[artist.toLowerCase()];
  return global;
}
