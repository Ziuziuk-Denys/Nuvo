import { describe, expect, it } from "vitest";
import { clampView, follow, moveRange, resizeRange, zoomAround } from "./timelineMath";

describe("timeline view", () => {
  it("keeps the view inside the song", () => {
    expect(clampView(-500, 20_000, 100_000)).toBe(0);
    expect(clampView(95_000, 20_000, 100_000)).toBe(80_000);
    expect(clampView(10_000, 200_000, 100_000)).toBe(0);
  });

  it("zooms around the moment under the cursor", () => {
    const from = zoomAround(40_000, 40_000, 200_000, 50_000, 20_000);
    expect(from).toBe(45_000);
    expect((50_000 - from) / 20_000).toBeCloseTo((50_000 - 40_000) / 40_000);
  });

  it("pages ahead when the playhead nears the right edge and leaves it alone otherwise", () => {
    expect(follow(0, 20_000, 10_000, 100_000)).toBe(0);
    expect(follow(0, 20_000, 19_500, 100_000)).toBe(17_500);
    expect(follow(30_000, 20_000, 5_000, 100_000)).toBe(3_000);
  });
});

describe("clip range", () => {
  const limits = { min: 5_000, max: 60_000, total: 100_000 };

  it("moves whole and stops at the song's ends", () => {
    expect(moveRange([10_000, 25_000], 5_000, limits)).toEqual([15_000, 30_000]);
    expect(moveRange([10_000, 25_000], -20_000, limits)).toEqual([0, 15_000]);
    expect(moveRange([80_000, 95_000], 20_000, limits)).toEqual([85_000, 100_000]);
  });

  it("resizes from either edge within the shortest and longest clip", () => {
    expect(resizeRange([10_000, 25_000], "from", 22_000, limits)).toEqual([20_000, 25_000]);
    expect(resizeRange([10_000, 25_000], "to", 90_000, limits)).toEqual([10_000, 70_000]);
    expect(resizeRange([10_000, 25_000], "to", 99_000, { ...limits, max: 120_000 })).toEqual([10_000, 99_000]);
  });
});
