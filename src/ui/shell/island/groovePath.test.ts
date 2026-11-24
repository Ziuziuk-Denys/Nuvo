import { expect, it } from "vitest";
import { groovePath, lens } from "./groovePath";

it("draws a closed contour from edge to edge, mirrored around the middle", () => {
  const path = groovePath([0, 1, 0]);
  expect(path.startsWith("M0 50L0 50")).toBe(true);
  expect(path.endsWith("L0 50Z")).toBe(true);
  expect(path).toContain("L1000 50L1000 50");
  expect(path).toContain("Q500 0 ");
  expect(path).toContain("Q500 100 ");
});

it("draws nothing without a shape", () => {
  expect(groovePath([])).toBe("");
});

it("lifts the line at the pointer and leaves it whole without one", () => {
  const flat = [1, 1, 1, 1, 1];
  expect(lens(flat, null)).toEqual(flat);
  const [left, , centre] = lens(flat, 0.5);
  expect(centre).toBe(1);
  expect(left).toBeCloseTo(0.34);
});
