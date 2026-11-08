import { describe, expect, it } from "vitest";
import { fft, PhaseVocoderShifter } from "./phaseVocoder";
import { generateImpulse } from "./reverbIr";
import { seededRandom } from "../shuffle";

const RATE = 48_000;

/** Dominant frequency by counting upward zero crossings. */
function frequency(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return (crossings * RATE) / samples.length;
}

function shift(semitones: number, hz: number): Float32Array {
  const shifter = new PhaseVocoderShifter();
  shifter.setSemitones(semitones);
  const blocks = 600;
  const out = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) {
    const input = new Float32Array(128);
    for (let i = 0; i < 128; i++) input[i] = Math.sin((2 * Math.PI * hz * (b * 128 + i)) / RATE) * 0.5;
    const output = [new Float32Array(128)];
    shifter.process([input], output);
    out.set(output[0], b * 128);
  }
  return out.slice(out.length / 2);
}

describe("pitch shifter (phase vocoder)", () => {
  it("fft round-trips", () => {
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i));
    const im = new Float64Array(16);
    const copy = Float64Array.from(re);
    fft(re, im, false);
    fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(copy[i], 9));
  });

  it("moves a 440 Hz tone up an octave and down a fifth, keeping its level", () => {
    const up = shift(12, 440);
    expect(frequency(up)).toBeGreaterThan(860);
    expect(frequency(up)).toBeLessThan(900);
    const down = shift(-7, 440);
    expect(frequency(down)).toBeGreaterThan(285);
    expect(frequency(down)).toBeLessThan(302);
    const peak = up.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThan(0.8);
  });

  it("passes the tone through unchanged at 0 semitones", () => {
    expect(Math.abs(frequency(shift(0, 440)) - 440)).toBeLessThan(10);
  });
});

describe("pitch shifter steadiness", () => {
  it("holds a steady level after a slow-down, with no amplitude warble", () => {
    const out = shift(-3, 440);
    const rms: number[] = [];
    for (let start = 0; start + 2048 <= out.length; start += 2048) {
      let sum = 0;
      for (let i = start; i < start + 2048; i++) sum += out[i] * out[i];
      rms.push(Math.sqrt(sum / 2048));
    }
    expect(Math.max(...rms) / Math.min(...rms)).toBeLessThan(1.05);
  });
});

describe("reverb impulse", () => {
  it("is a 2.8 s decorrelated stereo tail, soft at the start and peak-normalised", () => {
    const [left, right] = generateImpulse(RATE, seededRandom(1));
    expect(left.length).toBe(Math.round(RATE * 2.8));
    const peak = [...left, ...right].reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    expect(peak).toBeCloseTo(1, 5);
    expect(Math.abs(left[0])).toBeLessThan(0.05);
    let dot = 0;
    for (let i = 0; i < left.length; i++) dot += left[i] * right[i];
    expect(Math.abs(dot) / left.length).toBeLessThan(0.01);
    const energy = (from: number, to: number) => left.slice(from, to).reduce((s, v) => s + v * v, 0);
    expect(energy(RATE * 2.5, RATE * 2.8)).toBeLessThan(energy(RATE * 0.1, RATE * 0.4) / 100);
  });
});
