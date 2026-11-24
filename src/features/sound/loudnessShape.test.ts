import { expect, it } from "vitest";
import { loudnessShape } from "./loudnessShape";

const tone = (amplitudes: number[], per = 100) => Float32Array.from(amplitudes.flatMap((a) => Array.from({ length: per }, (_, i) => (i % 2 ? a : -a))));

it("measures loudness against the loudest part, in decibels", () => {
  const [loud, half, quiet, silent] = loudnessShape([tone([1, 0.5, 0.01, 0])], 4);
  expect(loud).toBe(1);
  expect(half).toBeCloseTo((1 - 6.02 / 24) ** 2.2, 2);
  expect(quiet).toBe(0);
  expect(silent).toBe(0);
});

it("adds the channels and survives silence", () => {
  expect(loudnessShape([tone([1, 0]), tone([0, 1])], 2)).toEqual([1, 1]);
  expect(loudnessShape([tone([0, 0])], 2)).toEqual([0, 0]);
  expect(loudnessShape([], 2)).toEqual([0, 0]);
});
