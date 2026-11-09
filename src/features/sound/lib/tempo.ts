export interface TempoSettings {
  rate: number;
  pitchSemitones: number;
  pitchLinked: boolean;
  reverb: number | null;
}

const linkedPitch = (rate: number) => Number((12 * Math.log2(rate)).toFixed(1));

export const TEMPO_PRESETS = {
  normal: { rate: 1, pitchSemitones: 0, pitchLinked: true, reverb: null },
  slowed: { rate: 0.85, pitchSemitones: linkedPitch(0.85), pitchLinked: true, reverb: null },
  slowedReverb: { rate: 0.85, pitchSemitones: linkedPitch(0.85), pitchLinked: true, reverb: 0.45 },
  spedUp: { rate: 1.25, pitchSemitones: linkedPitch(1.25), pitchLinked: true, reverb: null },
  nightcore: { rate: 1.25, pitchSemitones: 3, pitchLinked: false, reverb: null },
  daycore: { rate: 0.8, pitchSemitones: -2, pitchLinked: false, reverb: 0.3 },
} satisfies Record<string, TempoSettings>;

export type TempoPresetKey = keyof typeof TEMPO_PRESETS;

const RATE_TOLERANCE = 0.005;
const PITCH_TOLERANCE = 0.05;
const REVERB_TOLERANCE = 0.02;

export function sameTempo(a: TempoSettings, b: TempoSettings): boolean {
  if (a.pitchLinked !== b.pitchLinked) return false;
  if (Math.abs(a.rate - b.rate) > RATE_TOLERANCE) return false;
  if (Math.abs(a.pitchSemitones - b.pitchSemitones) > PITCH_TOLERANCE) return false;
  if (a.reverb === null || b.reverb === null) return a.reverb === b.reverb;
  return Math.abs(a.reverb - b.reverb) <= REVERB_TOLERANCE;
}

export function presetOf(settings: TempoSettings): TempoPresetKey | null {
  const keys = Object.keys(TEMPO_PRESETS) as TempoPresetKey[];
  return keys.find((key) => sameTempo(settings, TEMPO_PRESETS[key])) ?? null;
}

export function isNeutral(settings: TempoSettings): boolean {
  return presetOf(settings) === "normal";
}
