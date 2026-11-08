/**
 * Reverb impulse response generated at run time from a description: a stereo tail of about
 * 2.8 s, a soft onset of about 15 ms, independent noise per channel (decorrelated), a smooth exponential
 * decay that gets darker toward the end, peak-normalised. No recorded impulse response is used.
 */
import type { Random } from "../shuffle";

export const IR_SECONDS = 2.8;
export const IR_ONSET_S = 0.015;
/** Level after IR_SECONDS, as a fraction of the start (about -60 dB). */
const TAIL_LEVEL = 0.001;

export function generateImpulse(sampleRate: number, random: Random, seconds = IR_SECONDS): [Float32Array, Float32Array] {
  const length = Math.round(sampleRate * seconds);
  const decay = Math.log(TAIL_LEVEL) / length;
  const onset = Math.max(1, Math.round(sampleRate * IR_ONSET_S));
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  for (const data of channels) {
    let lowpassed = 0;
    for (let i = 0; i < length; i++) {
      const noise = random() * 2 - 1;
      // One-pole low-pass whose cutoff falls over the tail: early reflections bright, late ones dark.
      const progress = i / length;
      const smoothing = 0.1 + 0.85 * progress;
      lowpassed = lowpassed * smoothing + noise * (1 - smoothing);
      const envelope = Math.exp(decay * i) * Math.min(1, i / onset);
      data[i] = lowpassed * envelope;
    }
  }
  let peak = 0;
  for (const data of channels) for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (const data of channels) for (let i = 0; i < data.length; i++) data[i] /= peak;
  return channels;
}
