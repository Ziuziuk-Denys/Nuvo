import { describe, expect, it } from "vitest";
import type { Palette } from "../render/palette";
import { inkOf, TEXT_SIZE, textLookOf } from "./text";

describe("text look", () => {
  it("keeps a valid look and clamps the size", () => {
    expect(textLookOf({ size: 1.2, ink: "cover" })).toEqual({ size: 1.2, ink: "cover" });
    expect(textLookOf({ size: 9, ink: "auto" })).toEqual({ size: TEXT_SIZE.max, ink: "auto" });
    expect(textLookOf({ size: 0.1, ink: [2, -1, 0.5] })).toEqual({ size: TEXT_SIZE.min, ink: [1, 0, 0.5] });
  });

  it("falls back to the style's own look for anything it cannot read", () => {
    expect(textLookOf(undefined)).toBeUndefined();
    expect(textLookOf("big")).toBeUndefined();
    expect(textLookOf({ size: "large", ink: "pink" })).toEqual({ size: 1, ink: "auto" });
    expect(textLookOf({ ink: [1, 2] })).toEqual({ size: 1, ink: "auto" });
  });

  it("resolves the ink: none for the style's own, a vivid cover colour, or the picked colour", () => {
    const palette: Palette = { deep: [0.1, 0.1, 0.1], key: [0.4, 0.2, 0.1], cool: [0, 0, 0], light: [0.9, 0.9, 0.9] };
    expect(inkOf({ size: 1, ink: "auto" }, palette)).toBeNull();
    expect(inkOf(undefined, palette)).toBeNull();
    expect(inkOf({ size: 1, ink: "cover" }, palette)).toEqual([1, 0.5, 0.25]);
    expect(inkOf({ size: 1, ink: [0.2, 0.4, 0.6] }, palette)).toEqual([0.2, 0.4, 0.6]);
  });
});
