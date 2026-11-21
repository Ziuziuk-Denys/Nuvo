import { describe, expect, it } from "vitest";
import { inkOver } from "./sceneInk";

const COLS = 16;
const ROWS = 9;

function grid(left: number, right: number): Uint8Array {
  return Uint8Array.from({ length: COLS * ROWS }, (_, i) => (i % COLS < COLS / 2 ? left : right));
}

describe("scene ink", () => {
  it("picks dark ink over a light patch and light ink over a dark one, per area", () => {
    const cells = grid(30, 230);
    expect(inkOver(cells, { x: 0.05, y: 0.4, width: 0.2, height: 0.1 }, undefined)).toBe("light");
    expect(inkOver(cells, { x: 0.7, y: 0.4, width: 0.2, height: 0.1 }, undefined)).toBe("dark");
  });

  it("holds the current ink near the middle so an edge does not flicker", () => {
    const middle = grid(118, 118);
    expect(inkOver(middle, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, "light")).toBe("light");
    expect(inkOver(middle, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, "dark")).toBe("dark");
  });

  it("averages only the cells under the area, clamped to the frame", () => {
    const cells = grid(0, 255);
    expect(inkOver(cells, { x: 0.45, y: -0.2, width: 0.2, height: 1.5 }, undefined)).toBe("dark");
    expect(inkOver(cells, { x: -0.1, y: 0, width: 0.3, height: 1 }, undefined)).toBe("light");
  });
});
