import { describe, expect, it } from "vitest";
import { lightFromPixels, NEUTRAL_LIGHT } from "./coverLight";

const fill = (...colours: number[][]) => {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) data.set([...colours[i % colours.length], 255], i * 4);
  return data;
};
const channels = (css: string) => css.match(/\d+/g)!.map(Number);

function contrastOnBlack(css: string): number {
  const [r, g, b] = channels(css).map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) / 0.05;
}

describe("lightFromPixels", () => {
  it("takes the strongest hue instead of mixing two into grey", () => {
    const [r, , b] = channels(lightFromPixels(fill([220, 30, 40], [220, 40, 30], [40, 60, 200])));
    expect(r).toBeGreaterThan(b + 60);
  });

  it("answers a warm white for a cover without colour", () => {
    expect(lightFromPixels(fill([40, 40, 40], [200, 200, 200]))).toBe(NEUTRAL_LIGHT);
    expect(lightFromPixels(new Uint8ClampedArray())).toBe(NEUTRAL_LIGHT);
  });

  it("stays readable on the black island for any cover", () => {
    for (const colour of [
      [10, 10, 90],
      [60, 0, 0],
      [0, 40, 10],
      [255, 240, 0],
      [120, 60, 20],
    ])
      expect(contrastOnBlack(lightFromPixels(fill(colour)))).toBeGreaterThan(4.5);
  });
});
