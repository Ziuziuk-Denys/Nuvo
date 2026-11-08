import { describe, expect, it } from "vitest";
import { accentFromPixels } from "./accent";

function image(pixels: Array<[number, number, number, number?]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a = 255], i) => data.set([r, g, b, a], i * 4));
  return data;
}

function contrastOnBlack(r: number, g: number, b: number): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return (luminance + 0.05) / 0.05;
}

describe("accentFromPixels", () => {
  it("a red image gives a red hex", () => {
    expect(
      accentFromPixels(
        image([
          [255, 0, 0],
          [255, 0, 0],
        ]),
      ),
    ).toBe("#ff0000");
  });

  it("ignores dark and grey pixels", () => {
    const data = image([
      [255, 0, 0],
      [10, 10, 10],
      [128, 128, 128],
      [240, 240, 240],
      [20, 0, 0],
    ]);
    expect(accentFromPixels(data)).toBe("#ff0000");
  });

  it("ignores transparent pixels", () => {
    expect(
      accentFromPixels(
        image([
          [0, 0, 255, 0],
          [255, 0, 0],
        ]),
      ),
    ).toBe("#ff0000");
  });

  it("an all-black image falls back to white", () => {
    expect(
      accentFromPixels(
        image([
          [0, 0, 0],
          [0, 0, 0],
        ]),
      ),
    ).toBe("#ffffff");
  });

  it("lifts a dark blue until it has 3:1 contrast on black and stays blue", () => {
    const hex = accentFromPixels(image([[0, 0, 0xa0]]));
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(contrastOnBlack(r, g, b)).toBeGreaterThanOrEqual(3);
    expect(b).toBe(255);
    expect(r).toBeLessThan(b);
    expect(g).toBeLessThan(b);
  });

  it("leaves a colour that already reads untouched", () => {
    expect(accentFromPixels(image([[200, 40, 200]]))).toBe("#c828c8");
  });
});
