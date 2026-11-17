import { describe, expect, it } from "vitest";
import { watermarkLayout } from "./watermark";

describe("watermark layout", () => {
  it("sits at the bottom centre of every frame", () => {
    for (const [width, height] of [
      [1080, 1920],
      [1920, 1080],
      [1080, 1080],
    ]) {
      const place = watermarkLayout(width, height);
      expect(place.centreX).toBe(width / 2);
      expect(place.bottom).toBeGreaterThan(height * 0.85);
      expect(place.bottom).toBeLessThan(height);
    }
  });

  it("scales with the short side so it reads the same at every quality", () => {
    const hd = watermarkLayout(1080, 1920);
    const uhd = watermarkLayout(2160, 3840);
    expect(uhd.size / hd.size).toBeCloseTo(2, 1);
    expect(hd.size).toBeGreaterThanOrEqual(36);
    expect(hd.size).toBeLessThanOrEqual(48);
  });
});
