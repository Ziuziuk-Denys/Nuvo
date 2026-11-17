import { describe, expect, it } from "vitest";
import { createFft, logBands } from "./fft";

const RATE = 48_000;
const SIZE = 2048;

function sine(hz: number, amplitude = 1): Float32Array {
  const out = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

function peakBin(magnitudes: Float32Array): number {
  let best = 0;
  for (let i = 1; i < magnitudes.length; i++) if (magnitudes[i] > magnitudes[best]) best = i;
  return best;
}

function bandsOf(hz: number, amplitude = 1): Float32Array {
  const fft = createFft(SIZE);
  const magnitudes = new Float32Array(SIZE / 2);
  fft.magnitudes(sine(hz, amplitude), magnitudes);
  const bands = new Float32Array(64);
  logBands(magnitudes, RATE, bands);
  return bands;
}

describe("fft", () => {
  it("puts a 1 kHz sine in its bin", () => {
    const magnitudes = new Float32Array(SIZE / 2);
    createFft(SIZE).magnitudes(sine(1000), magnitudes);
    expect(peakBin(magnitudes)).toBe(Math.round((1000 * SIZE) / RATE));
  });

  it("reads a full-scale sine as about 1", () => {
    const magnitudes = new Float32Array(SIZE / 2);
    createFft(SIZE).magnitudes(sine(1500), magnitudes);
    expect(magnitudes[peakBin(magnitudes)]).toBeGreaterThan(0.85);
    expect(magnitudes[peakBin(magnitudes)]).toBeLessThan(1.05);
  });

  it("leaves the input window untouched", () => {
    const input = sine(440);
    const copy = input.slice();
    createFft(SIZE).magnitudes(input, new Float32Array(SIZE / 2));
    expect(input).toEqual(copy);
  });
});

describe("log bands", () => {
  it("maps silence to zeros without NaN", () => {
    const bands = bandsOf(1000, 0);
    expect([...bands].every((value) => value === 0)).toBe(true);
  });

  it("places a low tone below a high tone", () => {
    const low = bandsOf(100);
    const high = bandsOf(5000);
    expect(peakBin(low)).toBeLessThan(peakBin(high));
  });

  it("fills every band even where bins are sparse", () => {
    const fft = createFft(SIZE);
    const noise = new Float32Array(SIZE);
    let seed = 7;
    for (let i = 0; i < SIZE; i++) {
      seed = (seed * 16807) % 2147483647;
      noise[i] = seed / 2147483647 - 0.5;
    }
    const magnitudes = new Float32Array(SIZE / 2);
    fft.magnitudes(noise, magnitudes);
    const bands = new Float32Array(64);
    logBands(magnitudes, RATE, bands);
    expect([...bands].every((value) => value > 0)).toBe(true);
  });

  it("keeps a quiet tone lower than a loud one", () => {
    const loud = bandsOf(1000, 1);
    const quiet = bandsOf(1000, 0.01);
    expect(Math.max(...quiet)).toBeLessThan(Math.max(...loud));
    expect(Math.max(...quiet)).toBeGreaterThan(0);
  });
});
