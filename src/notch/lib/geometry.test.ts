import { describe, expect, it } from "vitest";
import { ISLAND_SIZES, NOTCH_WINDOW, WING, grownRect, islandPath, islandRect } from "./geometry";

describe("island geometry", () => {
  it("every state fits the fixed window", () => {
    for (const size of Object.values(ISLAND_SIZES)) {
      expect(size.width + WING * 2).toBeLessThanOrEqual(NOTCH_WINDOW.width);
      expect(size.height).toBeLessThanOrEqual(NOTCH_WINDOW.height);
    }
  });

  it("input rect is centered, flush top and covers the wings", () => {
    const rect = islandRect(ISLAND_SIZES.live);
    expect(rect.y).toBe(0);
    expect(rect.x * 2 + rect.width).toBe(NOTCH_WINDOW.width);
    expect(rect.width).toBeGreaterThanOrEqual(ISLAND_SIZES.live.width + WING * 2);
    expect(rect.height).toBeGreaterThanOrEqual(ISLAND_SIZES.live.height);
  });

  it("path has a flat top across the wings and closes", () => {
    const path = islandPath({ width: 272, height: 34, radius: 14 });
    expect(path.startsWith("M0 0 H300 ")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).toContain("H28 ");
  });

  it("clamps a radius that would not fit a short island", () => {
    const path = islandPath({ width: 200, height: 20, radius: 32 });
    expect(path).not.toContain("NaN");
    expect(path).not.toMatch(/V-/);
  });

  it("height below the wing keeps a non-negative radius", () => {
    const path = islandPath({ width: 100, height: 10, radius: 20 });
    expect(path).not.toContain("NaN");
    expect(path).not.toMatch(/V-/);
  });

  it("a growing rect leaves room for the spring overshoot, live to expanded", () => {
    const { live, expanded } = ISLAND_SIZES;
    const exact = islandRect(expanded);
    const rect = grownRect(live, expanded, 0.067);
    // 0.067 x 150 px of height and 0.067 x 168 px of width (half per side).
    expect(rect.y).toBe(0);
    expect(rect.height).toBeGreaterThanOrEqual(exact.height + 10);
    expect(rect.width).toBeGreaterThanOrEqual(exact.width + 11);
    expect(rect.x * 2 + rect.width).toBe(NOTCH_WINDOW.width);
    expect(rect.x).toBeLessThanOrEqual(exact.x - 5);
  });

  it("a growing rect never leaves the window and needs no padding without overshoot", () => {
    const { idle, expanded } = ISLAND_SIZES;
    const huge = grownRect(idle, expanded, 5);
    expect(huge).toEqual({ x: 0, y: 0, width: NOTCH_WINDOW.width, height: NOTCH_WINDOW.height });
    expect(grownRect(idle, expanded, 0)).toEqual(islandRect(expanded));
  });
});
