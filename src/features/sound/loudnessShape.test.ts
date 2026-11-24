import { expect, it } from "vitest";
import { loudnessShape, smooth, stretch } from "./loudnessShape";

const tone = (amplitudes: number[], per = 100) => Float32Array.from(amplitudes.flatMap((a) => Array.from({ length: per }, (_, i) => (i % 2 ? a : -a))));

it("measures loudness against the loudest part, in decibels", () => {
  const [loud, half, quiet, silent] = loudnessShape([tone([1, 0.5, 0.01, 0])], 4);
  expect(loud).toBe(1);
  expect(half).toBeCloseTo((1 - 6.02 / 24) ** 2, 2);
  expect(quiet).toBe(0);
  expect(silent).toBe(0);
});

it("adds the channels and survives silence", () => {
  expect(loudnessShape([tone([1, 0]), tone([0, 1])], 2)).toEqual([1, 1]);
  expect(loudnessShape([tone([0, 0])], 2)).toEqual([0, 0]);
  expect(loudnessShape([], 2)).toEqual([0, 0]);
});

it("low-passes the shape without moving a steady level or its ends", () => {
  expect(smooth([0.5, 0.5, 0.5, 0.5], 2)).toEqual([0.5, 0.5, 0.5, 0.5]);
  const peak = smooth([0, 0, 0, 1, 0, 0, 0], 1);
  expect(peak[3]).toBeCloseTo(1 / 3);
  expect(peak[2]).toBeCloseTo(2 / 9);
  expect(peak[0]).toBe(0);
  expect(smooth([0, 1], 0)).toEqual([0, 1]);
});

it("fills the line from the quietest to the loudest part, and leaves a level song alone", () => {
  expect(stretch([0.4, 0.6])).toEqual([0.06, 1]);
  expect(stretch([0.5, 0.52])).toEqual([0.5, 0.52]);
});
