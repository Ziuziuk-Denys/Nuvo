import { createFft, logBands } from "./fft";

export const WINDOW = 2048;
export const BANDS = 64;
export const WAVE = 512;

const MIN_HZ = 30;
const MAX_HZ = 16_000;
const ATTACK_MS = 25;
const RELEASE_MS = 220;
const SILENT_DB = -70;
const RANGE_DB = 24;
const PEAK_FALL_DB_PER_MS = 0.003;
const FLUX_WINDOW_MS = 1500;
const FLUX_FLOOR = 0.1;
const ONSET_RATIO = 1.6;
const ONSET_GAP_MS = 120;
const ONSET_DECAY_MS = 180;
const BEAT_MEMORY_MS = 8000;
const BEAT_MIN_MS = 300;
const BEAT_MAX_MS = 1000;
const BEAT_TOLERANCE = 0.08;

export interface Features {
  bands: Float32Array;
  bass: number;
  mid: number;
  high: number;
  level: number;
  flux: number;
  onset: number;
  beat: number;
  beatConfidence: number;
  beatMs: number;
  wave: Float32Array;
}

export interface Extractor {
  step(window: Float32Array, dtMs: number): Features;
  reset(): void;
}

interface Meter {
  peakDb: number;
  value: number;
}

function bandRange(sampleRate: number, size: number, fromHz: number, toHz: number): [number, number] {
  const binHz = sampleRate / size;
  return [Math.max(1, Math.round(fromHz / binHz)), Math.round(toHz / binHz)];
}

function rmsDb(values: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i <= to; i++) sum += values[i] * values[i];
  const rms = Math.sqrt(sum / (to - from + 1));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fold(intervalMs: number): number {
  let value = intervalMs;
  while (value < BEAT_MIN_MS) value *= 2;
  while (value > BEAT_MAX_MS) value /= 2;
  return value;
}

export function createExtractor(sampleRate: number): Extractor {
  const fft = createFft(WINDOW);
  const magnitudes = new Float32Array(WINDOW / 2);
  const bands = new Float32Array(BANDS);
  const previousBands = new Float32Array(BANDS);
  const bass = bandRange(sampleRate, WINDOW, MIN_HZ, 150);
  const mid = bandRange(sampleRate, WINDOW, 150, 2000);
  const high = bandRange(sampleRate, WINDOW, 2000, MAX_HZ);
  let meters: Meter[] = [];
  let clock = 0;
  let fluxHistory: { at: number; value: number }[] = [];
  let onset = 0;
  let lastOnset = -Infinity;
  let onsets: number[] = [];
  let beatMs = 0;
  let beatConfidence = 0;
  let phase = 0;

  function reset(): void {
    meters = [0, 1, 2, 3].map(() => ({ peakDb: -Infinity, value: 0 }));
    previousBands.fill(0);
    clock = 0;
    fluxHistory = [];
    onset = 0;
    lastOnset = -Infinity;
    onsets = [];
    beatMs = 0;
    beatConfidence = 0;
    phase = 0;
  }
  reset();

  function meter(target: Meter, db: number, dtMs: number): number {
    target.peakDb = Math.max(db, target.peakDb - PEAK_FALL_DB_PER_MS * dtMs);
    const raw = db > SILENT_DB ? Math.min(1, Math.max(0, 1 - (target.peakDb - db) / RANGE_DB)) : 0;
    const constant = raw > target.value ? ATTACK_MS : RELEASE_MS;
    target.value += (raw - target.value) * (1 - Math.exp(-dtMs / constant));
    if (target.value < 1e-4) target.value = 0;
    return target.value;
  }

  function updateBeat(): void {
    const intervals: number[] = [];
    for (let i = 1; i < onsets.length; i++) intervals.push(fold(onsets[i] - onsets[i - 1]));
    if (intervals.length < 3) return;
    beatMs = median(intervals);
    const close = intervals.filter((value) => Math.abs(value - beatMs) <= beatMs * BEAT_TOLERANCE).length;
    beatConfidence = close / intervals.length;
  }

  function step(window: Float32Array, dtMs: number): Features {
    clock += dtMs;
    fft.magnitudes(window, magnitudes);
    logBands(magnitudes, sampleRate, bands, MIN_HZ, MAX_HZ);

    let flux = 0;
    for (let i = 0; i < BANDS; i++) {
      flux += Math.max(0, bands[i] - previousBands[i]);
      previousBands[i] = bands[i];
    }
    fluxHistory.push({ at: clock, value: flux });
    while (fluxHistory[0].at < clock - FLUX_WINDOW_MS) fluxHistory.shift();
    const typical = Math.max(median(fluxHistory.map((entry) => entry.value)), 1e-4);
    const ratio = flux / typical;

    onset *= Math.exp(-dtMs / ONSET_DECAY_MS);
    if (onset < 1e-4) onset = 0;
    if (flux > FLUX_FLOOR && ratio > ONSET_RATIO && clock - lastOnset >= ONSET_GAP_MS) {
      onset = 1;
      lastOnset = clock;
      onsets.push(clock);
      while (onsets[0] < clock - BEAT_MEMORY_MS) onsets.shift();
      updateBeat();
      if (beatMs > 0 && (phase < 0.2 || phase > 0.8)) phase = 0;
    } else if (beatMs > 0) {
      phase = (phase + dtMs / beatMs) % 1;
    }

    let timeSum = 0;
    for (let i = 0; i < WINDOW; i++) timeSum += window[i] * window[i];
    const levelDb = timeSum > 0 ? 10 * Math.log10(timeSum / WINDOW) : -Infinity;

    return {
      bands: bands.slice(),
      bass: meter(meters[0], rmsDb(magnitudes, bass[0], bass[1]), dtMs),
      mid: meter(meters[1], rmsDb(magnitudes, mid[0], mid[1]), dtMs),
      high: meter(meters[2], rmsDb(magnitudes, high[0], high[1]), dtMs),
      level: meter(meters[3], levelDb, dtMs),
      flux: Math.min(1, ratio / 4),
      onset,
      beat: phase,
      beatConfidence,
      beatMs,
      wave: window.slice(WINDOW - WAVE),
    };
  }

  return { step, reset };
}
