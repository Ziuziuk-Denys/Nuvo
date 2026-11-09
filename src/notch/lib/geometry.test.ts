import { describe, expect, it } from "vitest";
import { HIT_SLOP, ISLAND_SIZES, NOTCH_WINDOW, WING, capturesPointer, grownRect, islandPath, islandRect } from "./geometry";
import { MORPH_SPRING, simulateSpring } from "./spring";

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

  it("the window holds every grow with the real overshoot and is no bigger than that", () => {
    const overshoot = Math.max(...simulateSpring(MORPH_SPRING).values) - 1;
    const roomy = { width: 4000, height: 4000 };
    const sizes = Object.values(ISLAND_SIZES);
    const grows = sizes.flatMap((from) => sizes.map((to) => grownRect(from, to, overshoot, roomy)));
    const widest = Math.max(...grows.map((rect) => rect.width));
    const tallest = Math.max(...grows.map((rect) => rect.height));
    expect(widest).toBeLessThanOrEqual(NOTCH_WINDOW.width);
    expect(tallest).toBeLessThanOrEqual(NOTCH_WINDOW.height);
    expect(NOTCH_WINDOW.width - widest).toBeLessThan(10);
    expect(NOTCH_WINDOW.height - tallest).toBeLessThan(10);
  });
});

describe("pointer capture", () => {
  const rect = { x: 100, y: 0, width: 200, height: 40 };

  it("captures only inside the pill", () => {
    expect(capturesPointer({ x: 150, y: 10 }, rect, false)).toBe(true);
    expect(capturesPointer({ x: 100, y: 0 }, rect, false)).toBe(true);
    expect(capturesPointer({ x: 300, y: 10 }, rect, false)).toBe(false);
    expect(capturesPointer({ x: 99, y: 10 }, rect, false)).toBe(false);
    expect(capturesPointer({ x: 150, y: 40 }, rect, false)).toBe(false);
    expect(capturesPointer(null, rect, false)).toBe(false);
  });

  it("holds the capture within the slop so the edge does not flicker", () => {
    expect(capturesPointer({ x: 100 - HIT_SLOP, y: 10 }, rect, true)).toBe(true);
    expect(capturesPointer({ x: 150, y: 40 + HIT_SLOP - 1 }, rect, true)).toBe(true);
    expect(capturesPointer({ x: 100 - HIT_SLOP, y: 10 }, rect, false)).toBe(false);
    expect(capturesPointer({ x: 100 - HIT_SLOP - 1, y: 10 }, rect, true)).toBe(false);
    expect(capturesPointer({ x: 150, y: 40 + HIT_SLOP }, rect, true)).toBe(false);
  });

  it("keeps a drag that started on the pill, then lets go once the button is up", () => {
    const far = { x: 900, y: 500 };
    expect(capturesPointer(far, rect, true, 1)).toBe(true);
    expect(capturesPointer(null, rect, true, 1)).toBe(true);
    expect(capturesPointer(far, rect, true, 0)).toBe(false);
    expect(capturesPointer(null, rect, true, 0)).toBe(false);
    expect(capturesPointer(far, rect, false, 1)).toBe(false);
  });

  it("follows the pill as it grows and shrinks under a still pointer", () => {
    const point = { x: 150, y: 120 };
    expect(capturesPointer(point, islandRect(ISLAND_SIZES.idle), true)).toBe(false);
    const expanded = islandRect(ISLAND_SIZES.expanded);
    expect(capturesPointer({ x: expanded.x + 20, y: 120 }, expanded, false)).toBe(true);
    expect(capturesPointer({ x: expanded.x + 20, y: 120 }, islandRect(ISLAND_SIZES.live), true)).toBe(false);
  });
});
