import { describe, expect, it } from "vitest";
import type { Features } from "./features";
import { RING_POINTS, createRing } from "./ring";

const quiet: Features = {
  bands: new Float32Array(64),
  bass: 0,
  mid: 0,
  high: 0,
  level: 0,
  flux: 0,
  onset: 0,
  beat: 0,
  beatConfidence: 0,
  beatMs: 0,
  wave: new Float32Array(512),
};

const max = (values: Float32Array) => Math.max(...values);
const min = (values: Float32Array) => Math.min(...values);

describe("liquid ring", () => {
  it("rests at zero in silence", () => {
    const ring = createRing();
    let shape: Float32Array = new Float32Array(RING_POINTS);
    for (let i = 0; i < 120; i++) shape = ring.step(1000 / 60, quiet);
    expect(max(shape)).toBe(0);
    expect(min(shape)).toBe(0);
  });

  it("swells on a hit, overshoots back and settles", () => {
    const ring = createRing();
    const peaks: number[] = [];
    for (let i = 0; i < 240; i++) {
      const features = i === 0 ? { ...quiet, onset: 1, bass: 1 } : quiet;
      peaks.push(ring.step(1000 / 60, features)[RING_POINTS / 4]);
    }
    expect(Math.max(...peaks)).toBeGreaterThan(0.2);
    expect(Math.min(...peaks.slice(5))).toBeLessThan(0);
    expect(Math.abs(peaks.at(-1)!)).toBeLessThan(0.01);
  });

  it("moves the same whatever the frame rate", () => {
    const at60 = createRing();
    const at120 = createRing();
    const loud = { ...quiet, bass: 0.8, bands: new Float32Array(64).fill(0.8) };
    let a: Float32Array = new Float32Array(RING_POINTS);
    let b: Float32Array = new Float32Array(RING_POINTS);
    for (let i = 0; i < 60; i++) a = at60.step(1000 / 60, loud);
    for (let i = 0; i < 120; i++) b = at120.step(1000 / 120, loud);
    for (let i = 0; i < RING_POINTS; i++) expect(a[i]).toBeCloseTo(b[i], 3);
  });

  it("follows a steady bass outward", () => {
    const ring = createRing();
    let shape: Float32Array = new Float32Array(RING_POINTS);
    for (let i = 0; i < 240; i++) shape = ring.step(1000 / 60, { ...quiet, bass: 1 });
    expect(min(shape)).toBeGreaterThan(0.05);
  });

  it("stays finite under a long dense beat", () => {
    const ring = createRing();
    let shape: Float32Array = new Float32Array(RING_POINTS);
    for (let i = 0; i < 2000; i++)
      shape = ring.step(1000 / 60, { ...quiet, bass: 1, level: 1, onset: i % 8 === 0 ? 1 : 0.3, bands: new Float32Array(64).fill(1) });
    expect(shape.every(Number.isFinite)).toBe(true);
    expect(max(shape)).toBeLessThan(2);
  });
});
