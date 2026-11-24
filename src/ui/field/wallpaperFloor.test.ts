import { describe, expect, it } from "vitest";
import { contrastRatio } from "../ports/color";
import { dimFloor } from "./wallpaperFloor";

const picture = (...cells: [number, number, number][]) => new Uint8ClampedArray(cells.flatMap((cell) => [...cell, 255]));
const DARK = ["#f5f5fa", "#06070c"] as const;
const LIGHT = ["#101320", "#f3f4f9"] as const;

describe("dimFloor", () => {
  it("leaves a wallpaper alone where the captions already read", () => {
    expect(dimFloor(picture([10, 10, 14]), ...DARK)).toBe(0);
    expect(dimFloor(picture([245, 245, 245]), ...LIGHT)).toBe(0);
  });

  it("dims a bright wallpaper in a dark theme, and a dark one in a light theme, only as far as needed", () => {
    for (const [cell, [ink, ground]] of [
      [[200, 190, 180], DARK],
      [[60, 50, 60], LIGHT],
    ] as const) {
      const dim = dimFloor(picture([...cell]), ink, ground);
      expect(dim).toBeGreaterThan(0.1);
      expect(dim).toBeLessThan(0.7);
      const under = ground === "#06070c" ? [6, 7, 12] : [243, 244, 249];
      const mixed = cell.map((channel, i) => Math.round(channel + (under[i] - channel) * dim));
      expect(contrastRatio(ink, `rgb(${mixed.join(", ")})`)).toBeGreaterThan(4.5);
    }
  });

  it("does not drown the whole picture for one bright spot", () => {
    const cells = Array.from({ length: 20 }, (_, i) => (i === 0 ? [255, 255, 255] : [12, 12, 16])) as [number, number, number][];
    expect(dimFloor(picture(...cells), ...DARK)).toBe(0);
  });
});
