import { describe, expect, it } from "vitest";
import { readLight, toScreen } from "./readLight";
import { lightVars } from "./useLightVars";

type Paint = (x: number, y: number) => [number, number, number];

function cover(paint: Paint): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i += 1) pixels.set([...paint(i % 32, Math.floor(i / 32)), 255], i * 4);
  return pixels;
}

const spread = (colour: readonly number[]) => Math.max(...colour) - Math.min(...colour);

describe("readLight", () => {
  it("takes the lamp's hue from the cover and keeps it lighter than a saturated source", () => {
    const { key } = readLight(cover(() => [200, 20, 20]));
    expect(key[0]).toBeGreaterThan(key[1]);
    expect(key[0]).toBeGreaterThan(key[2]);
    expect(toScreen(key[1])).toBeGreaterThan(90);
  });

  it("gives black, white and grey covers one neutral lamp", () => {
    const lamps = [0, 128, 255].map((value) => readLight(cover(() => [value, value, value])).key);
    expect(lamps[1]).toEqual(lamps[0]);
    expect(lamps[2]).toEqual(lamps[0]);
    expect(spread(lamps[0])).toBeLessThan(0.1);
    expect(Math.min(...lamps[0])).toBeGreaterThan(0.4);
  });

  it("points at the bright part of the cover", () => {
    const { from } = readLight(cover((x, y) => (x > 24 && y < 8 ? [255, 255, 255] : [10, 10, 10])));
    expect(from[0]).toBeGreaterThan(0.5);
    expect(from[1]).toBeLessThan(-0.5);
  });

  it("takes the rim from a second hue and the cells from where the colours are", () => {
    const { key, rim, cells } = readLight(cover((x) => (x < 22 ? [20, 60, 220] : [230, 120, 20])));
    expect(key[2]).toBeGreaterThan(key[0]);
    expect(rim[0]).toBeGreaterThan(rim[2]);
    expect(cells[2]).toBeGreaterThan(cells[0]);
    expect(cells[9]).toBeGreaterThan(cells[11]);
  });
});

describe("lightVars", () => {
  it("tells how bright the cover gets, so ink over a photo can be shaded for it", () => {
    const dark = readLight(cover((x, y) => (x < 8 && y >= 24 ? [255, 255, 255] : [0, 0, 0])));
    expect(Number(lightVars(dark)["--n-cover-bright"])).toBeCloseTo(1, 1);
    expect(Number(lightVars(readLight(cover(() => [10, 10, 10])))["--n-cover-bright"])).toBeLessThan(0.01);
  });
});
