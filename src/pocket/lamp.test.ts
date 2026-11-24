import { expect, it, describe } from "vitest";
import { lampColor } from "./lamp";

const pixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

describe("lampColor", () => {
  it("takes the strongest hue instead of mixing two into grey", () => {
    const [r, , b] = channels(lampColor(pixels([220, 30, 40], [220, 30, 40], [220, 40, 30], [40, 60, 200])));
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
  });

  it("keeps a colourless cover neutral and lifts a dark one", () => {
    const [r, g, b] = channels(lampColor(pixels([40, 40, 42], [20, 20, 20])));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(150);
  });

  it("answers white for an empty sample", () => {
    expect(lampColor(new Uint8ClampedArray())).toBe("#ffffff");
  });
});
