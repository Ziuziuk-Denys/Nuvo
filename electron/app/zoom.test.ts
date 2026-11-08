import { describe, expect, it } from "vitest";
import { nextZoom, validZoom, zoomKey } from "./zoom";

const press = (key: string, extra: Partial<{ control: boolean; meta: boolean; alt: boolean; type: string }> = {}) => ({
  type: "keyDown",
  key,
  control: true,
  meta: false,
  alt: false,
  ...extra,
});

describe("zoom keys", () => {
  it("reads Ctrl with plus or equals, minus and zero, and nothing else", () => {
    expect(["+", "=", "-", "_", "0"].map((key) => zoomKey(press(key), false))).toEqual(["in", "in", "out", "out", "reset"]);
    expect(zoomKey(press("=", { control: false }), false)).toBeNull();
    expect(zoomKey(press("=", { alt: true }), false)).toBeNull();
    expect(zoomKey(press("=", { type: "keyUp" }), false)).toBeNull();
    expect(zoomKey(press("1"), false)).toBeNull();
    expect(zoomKey(press("=", { control: false, meta: true }), true)).toBe("in");
  });

  it("steps by half a level inside the limits and resets to 0", () => {
    expect(nextZoom(0, "in")).toBe(0.5);
    expect(nextZoom(0, "out")).toBe(-0.5);
    expect(nextZoom(3, "in")).toBe(3);
    expect(nextZoom(-3, "out")).toBe(-3);
    expect(nextZoom(2, "reset")).toBe(0);
  });

  it("reads a stored level back only when it is a finite number, clamped", () => {
    expect(validZoom(1.5)).toBe(1.5);
    expect(validZoom(9)).toBe(3);
    expect(validZoom("2")).toBe(0);
    expect(validZoom(Number.NaN)).toBe(0);
  });
});
