import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, luminance, paletteFrom, type Rgb } from "./palette";

function image(fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) out.set(fill(x, y), (y * 32 + x) * 4);
  return out;
}

const hueOf = ([r, g, b]: Rgb) => (r > b && r > g ? "red" : b > r && b > g ? "blue" : g > r && g > b ? "green" : "grey");

describe("cover palette", () => {
  it("takes key and cool from the two strongest hues", () => {
    const pixels = image((x) => (x < 20 ? [200, 30, 30, 255] : [40, 60, 210, 255]));
    const palette = paletteFrom(pixels);
    expect(hueOf(palette.key)).toBe("red");
    expect(hueOf(palette.cool)).toBe("blue");
  });

  it("keeps deep dark and light bright whatever the cover", () => {
    for (const fill of [
      [250, 240, 230, 255],
      [10, 10, 12, 255],
      [120, 90, 200, 255],
    ] as const) {
      const palette = paletteFrom(image(() => [...fill]));
      expect(luminance(palette.deep)).toBeLessThanOrEqual(0.05);
      expect(luminance(palette.light)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("keeps the deep colour's hue", () => {
    const palette = paletteFrom(image((x, y) => (y < 16 ? [20, 30, 120, 255] : [230, 230, 240, 255])));
    expect(hueOf(palette.deep)).toBe("blue");
  });

  it("falls back to the default for an empty image", () => {
    expect(paletteFrom(new Uint8ClampedArray(32 * 32 * 4))).toEqual(DEFAULT_PALETTE);
  });

  it("stays grey for a grey cover", () => {
    const palette = paletteFrom(image((x) => [x * 8, x * 8, x * 8, 255]));
    for (const colour of [palette.key, palette.cool]) expect(Math.max(...colour) - Math.min(...colour)).toBeLessThan(0.05);
  });
});
