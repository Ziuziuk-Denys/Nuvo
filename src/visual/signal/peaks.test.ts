import { describe, expect, it } from "vitest";
import { peaks } from "./peaks";

describe("waveform peaks", () => {
  it("returns one value per bin between 0 and 1", () => {
    const pcm = new Float32Array(48_000).map((_, i) => Math.sin(i / 10) * (i / 48_000));
    const out = peaks(pcm, 100);
    expect(out).toHaveLength(100);
    expect(Math.max(...out)).toBeCloseTo(1, 5);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
  });

  it("follows loudness: a quiet half sits below a loud half", () => {
    const pcm = new Float32Array(20_000).map((_, i) => Math.sin(i / 7) * (i < 10_000 ? 0.1 : 0.9));
    const out = peaks(pcm, 20);
    expect(out[2]).toBeLessThan(out[15]);
  });

  it("is all zeros for silence", () => {
    expect(peaks(new Float32Array(1000), 10).every((value) => value === 0)).toBe(true);
  });
});
