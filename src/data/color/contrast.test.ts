import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "./contrast";

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("composites translucent text over the background", () => {
    expect(contrastRatio("rgba(0, 0, 0, 0.45)", "#f5f5f7")).toBeLessThan(4.5);
    expect(contrastRatio("rgba(0, 0, 0, 0.6)", "#f5f5f7")).toBeGreaterThan(4.5);
  });

  it("parses short hex and rgba", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });
});
