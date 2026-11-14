import { describe, expect, it } from "vitest";
import { BACK_WAVE, FRONT_WAVE, follow, shapeBands, wavePath } from "./spectrumWave";

const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("spectrum wave", () => {
  it("tilts equal input so the highs rise above the lows, keeps silence at zero and stays within 0..1", () => {
    const out = new Float32Array(48);
    shapeBands(new Float32Array(48).fill(0.5), out);
    expect(out[47]).toBeGreaterThan(out[0]);
    shapeBands(new Float32Array(48), out);
    expect(Array.from(out).every((level) => level === 0)).toBe(true);
    shapeBands(new Float32Array(48).fill(1), out);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });

  it("rises faster than it falls, and the back layer moves slower than the front", () => {
    const front = new Float32Array(1);
    const back = new Float32Array(1);
    const loud = new Float32Array([1]);
    follow(front, loud, FRONT_WAVE);
    follow(back, loud, BACK_WAVE);
    expect(front[0]).toBeGreaterThan(back[0]);
    const rise = front[0];
    const level = new Float32Array([1]);
    follow(level, new Float32Array([0]), FRONT_WAVE);
    expect(1 - level[0]).toBeLessThan(rise);
  });

  it("decays to silence without a target and then reports that it has settled", () => {
    const levels = new Float32Array(4).fill(0.8);
    expect(follow(levels, null, FRONT_WAVE)).toBe(false);
    let frames = 0;
    while (!follow(levels, null, FRONT_WAVE)) frames++;
    expect(frames).toBeLessThan(120);
  });

  it("draws a closed smooth path that never overshoots the loudest band or dips under the floor", () => {
    const levels = new Float32Array([0, 1, 0, 0.2, 0.9, 0.1, 0.5, 0]);
    const path = wavePath(levels, 1000, 128, 108);
    expect(path.startsWith("M-12,140.0")).toBe(true);
    expect(path.endsWith("L1012.0,140.0Z")).toBe(true);
    expect(path).toContain("C");
    const ys = numbers(path)
      .filter((_, index) => index % 2 === 1)
      .slice(1, -1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(128 - 108);
    expect(Math.max(...ys)).toBeLessThanOrEqual(128);
  });
});
