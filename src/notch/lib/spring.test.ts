import { describe, expect, it } from "vitest";
import { MORPH_SPRING, simulateSpring, springEasing } from "./spring";

describe("spring easing", () => {
  it("settles at 1 without overshoot in under half a second", () => {
    const { values, durationMs } = simulateSpring(MORPH_SPRING);
    expect(values.at(-1)).toBeCloseTo(1, 2);
    expect(Math.max(...values)).toBeLessThan(1.002);
    expect(durationMs).toBeGreaterThan(250);
    expect(durationMs).toBeLessThan(500);
  });

  it("emits a CSS linear() function that starts at 0 and ends at 1", () => {
    const { easing } = springEasing(MORPH_SPRING, 16);
    expect(easing.startsWith("linear(0, ")).toBe(true);
    expect(easing.endsWith(", 1)")).toBe(true);
    expect(easing.split(",")).toHaveLength(17);
  });

  it("an overdamped spring never overshoots", () => {
    const { values } = simulateSpring({ stiffness: 200, damping: 60, mass: 1 });
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });
});
