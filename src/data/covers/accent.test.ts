import { describe, expect, it } from "vitest";
import { hslToRgb, rgbToHsl } from "../color/hsl";
import { NEUTRAL_ACCENT, coverAccent } from "./accent";

function cover(colors: Array<[number, number, number, number]>): Uint8ClampedArray {
  const pixels: number[] = [];
  for (const [r, g, b, count] of colors) for (let i = 0; i < count; i += 1) pixels.push(r, g, b, 255);
  return new Uint8ClampedArray(pixels);
}

describe("HSL helpers", () => {
  it("round-trips", () => {
    const [h, s, l] = rgbToHsl(200, 40, 90);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(hslToRgb(h, s, l)).toEqual([200, 40, 90]);
  });
});

describe("coverAccent", () => {
  it("takes the dominant saturated hue and moves lightness per mode", () => {
    const pixels = cover([
      [220, 30, 40, 600],
      [30, 60, 220, 200],
      [128, 128, 128, 800],
    ]);
    const light = coverAccent(pixels, true);
    const dark = coverAccent(pixels, false);
    const [hl, sl, ll] = rgbToHsl(...(light.match(/\d+/g)!.map(Number) as [number, number, number]));
    const [, , ld] = rgbToHsl(...(dark.match(/\d+/g)!.map(Number) as [number, number, number]));
    expect(hl < 15 || hl > 345).toBe(true);
    expect(sl).toBeGreaterThanOrEqual(0.44);
    expect(ll).toBeCloseTo(0.42, 1);
    expect(ld).toBeCloseTo(0.66, 1);
  });

  it("a grey cover gives the neutral accent", () => {
    const grey = cover([[120, 120, 120, 1000]]);
    expect(coverAccent(grey, true)).toBe(NEUTRAL_ACCENT.light);
    expect(coverAccent(grey, false)).toBe(NEUTRAL_ACCENT.dark);
  });
});
