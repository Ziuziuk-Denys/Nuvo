import { describe, expect, it } from "vitest";
import { integratedLoudness, normalizationGain, peakOf } from "./loudness";

const RATE = 48000;

function sine(freq: number, amplitude: number, seconds: number): Float32Array {
  const out = new Float32Array(RATE * seconds);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

describe("loudness", () => {
  it("measures a full-scale 1 kHz sine near -3 LUFS (mono reference)", () => {
    expect(integratedLoudness([sine(1000, 1, 5)], RATE)).toBeCloseTo(-3.01, 0);
  });

  it("is 20 dB lower for a sine at one tenth the amplitude", () => {
    const loud = integratedLoudness([sine(1000, 1, 4)], RATE);
    const quiet = integratedLoudness([sine(1000, 0.1, 4)], RATE);
    expect(loud - quiet).toBeCloseTo(20, 0);
  });

  it("gates out silence: half silence does not lower the result", () => {
    const tone = sine(1000, 0.5, 3);
    const padded = new Float32Array(tone.length * 2);
    padded.set(tone);
    expect(integratedLoudness([padded], RATE)).toBeCloseTo(integratedLoudness([tone], RATE), 0);
    expect(integratedLoudness([new Float32Array(RATE * 2)], RATE)).toBe(-Infinity);
  });

  it("gain targets -14 LUFS, clamps to 12 dB and respects -1 dBFS peak", () => {
    expect(normalizationGain(-20, 0.1)).toBeCloseTo(6, 5);
    expect(normalizationGain(-40, 0.01)).toBe(12);
    expect(normalizationGain(-20, 0.9)).toBeCloseTo(-1 - 20 * Math.log10(0.9), 5);
    expect(normalizationGain(-Infinity, 0)).toBe(0);
    expect(normalizationGain(-8, 1)).toBe(-6);
  });

  it("peak across channels", () => {
    expect(peakOf([new Float32Array([0.2, -0.7, 0.5])])).toBeCloseTo(0.7, 6);
    expect(peakOf([new Float32Array([0.2, -0.7]), new Float32Array([0.9, 0.1])])).toBeCloseTo(0.9, 5);
  });

  it("stereo: identical L and R at full scale read ≈ 0 LUFS (3 dB above mono)", () => {
    const sine1k = sine(1000, 1, 5);
    expect(integratedLoudness([sine1k, sine1k], RATE)).toBeCloseTo(0, 0.5);
  });
});
