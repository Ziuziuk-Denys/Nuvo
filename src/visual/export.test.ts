import { describe, expect, it } from "vitest";
import { bitrateFor, codecsFor, fadeAt, frameSize } from "./export";

describe("clip export sizes", () => {
  it("puts the quality on the short side for every frame", () => {
    expect(frameSize("tall", "1080p")).toEqual({ width: 1080, height: 1920 });
    expect(frameSize("wide", "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(frameSize("square", "720p")).toEqual({ width: 720, height: 720 });
    expect(frameSize("wide", "2k")).toEqual({ width: 2560, height: 1440 });
    expect(frameSize("tall", "4k")).toEqual({ width: 2160, height: 3840 });
  });

  it("spends more bits on more pixels and frames, within a cap", () => {
    expect(bitrateFor(1920, 1080, 60)).toBeGreaterThan(bitrateFor(1280, 720, 60));
    expect(bitrateFor(1920, 1080, 60)).toBeGreaterThan(bitrateFor(1920, 1080, 30));
    expect(bitrateFor(1920, 1080, 60)).toBeGreaterThanOrEqual(12_000_000);
    expect(bitrateFor(3840, 2160, 60)).toBeLessThanOrEqual(50_000_000);
  });

  it("asks for High first and falls back to Baseline, with a level that fits the frame", () => {
    const small = codecsFor(1280, 720, 60);
    expect(small[0]).toMatch(/^avc1\.64/);
    expect(small.at(-1)).toMatch(/^avc1\.42/);
    expect(codecsFor(3840, 2160, 60).every((codec) => codec.endsWith("34"))).toBe(true);
    expect(codecsFor(1920, 1080, 60).every((codec) => codec.endsWith("2a"))).toBe(true);
  });
});

describe("clip fades", () => {
  it("rises from black at the start and falls to black at the end", () => {
    expect(fadeAt(0, 15_000, 800)).toBe(0);
    expect(fadeAt(400, 15_000, 800)).toBeCloseTo(0.5, 1);
    expect(fadeAt(5_000, 15_000, 800)).toBe(1);
    expect(fadeAt(15_000, 15_000, 800)).toBe(0);
  });

  it("stays fully visible without a fade and never fades past half of a short clip", () => {
    expect(fadeAt(0, 15_000, 0)).toBe(1);
    expect(fadeAt(1_000, 2_000, 5_000)).toBe(1);
  });
});
