/** Rate, pitch and volume arithmetic. Pure. */

export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const SEMITONES_LIMIT = 12;
/** Below this magnitude the pitch stage stays dry. */
export const PITCH_ACTIVE = 0.05;

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampRate(rate: number): number {
  return Number.isFinite(rate) ? round(clamp(rate, RATE_MIN, RATE_MAX), 2) : 1;
}

export function clampSemitones(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  const value = round(clamp(semitones, -SEMITONES_LIMIT, SEMITONES_LIMIT), 1);
  return Object.is(value, -0) ? 0 : value;
}

export function semitonesForRate(rate: number): number {
  return clampSemitones(12 * Math.log2(rate));
}

export function rateForSemitones(semitones: number): number {
  return clampRate(2 ** (semitones / 12));
}

export interface Tempo {
  rate: number;
  semitones: number;
  linked: boolean;
}

/** Applies a partial change the way the controls do: linked moves both, unlinked moves one. */
export function nextTempo(current: Tempo, change: { rate?: number; semitones?: number; linked?: boolean }): Tempo {
  let { rate, semitones, linked } = current;
  if (change.linked !== undefined && change.linked !== linked) {
    linked = change.linked;
    if (linked) semitones = semitonesForRate(rate);
  }
  if (change.rate !== undefined) {
    rate = clampRate(change.rate);
    if (linked) semitones = semitonesForRate(rate);
  }
  if (change.semitones !== undefined) {
    semitones = clampSemitones(change.semitones);
    if (linked) rate = rateForSemitones(semitones);
  }
  return { rate, semitones, linked };
}

/** The element preserves pitch only when unlinked; the worklet shifts only when unlinked and audible. */
export function pitchStageActive(tempo: Tempo): boolean {
  return !tempo.linked && Math.abs(tempo.semitones) >= PITCH_ACTIVE;
}

export function clampVolume(gain: number): number {
  return Number.isFinite(gain) ? clamp(gain, 0, 1) : 1;
}

/** The slider shows sqrt(gain), so equal steps sound roughly equal. */
export function gainFromSlider(level: number): number {
  const clamped = clampVolume(level);
  return clamped * clamped;
}

export function sliderFromGain(gain: number): number {
  return Math.sqrt(clampVolume(gain));
}

/** `volumeDelta` from remote surfaces: clamped, two decimals. */
export function volumeAfterDelta(volume: number, delta: number): number {
  return round(clampVolume(volume + delta), 2);
}
