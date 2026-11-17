import { describe, expect, it } from "vitest";
import { DISPLAY_LEAD_MS, lyricsTime } from "./paint";
import { ANIMATIONS } from "./type/animations";

describe("lyrics timing", () => {
  it("draws every animation ahead by the time its entrance needs to become readable", () => {
    for (const animation of Object.values(ANIMATIONS)) {
      expect(animation.leadMs).toBeGreaterThan(0);
      expect(animation.leadMs).toBeLessThanOrEqual(200);
      expect(lyricsTime(10_000, animation, 0)).toBe(10_000 + animation.leadMs);
    }
  });

  it("adds the display delay on screen, but not in an exported file", () => {
    const flow = ANIMATIONS.flow;
    expect(lyricsTime(10_000, flow, DISPLAY_LEAD_MS) - lyricsTime(10_000, flow, 0)).toBe(DISPLAY_LEAD_MS);
    expect(DISPLAY_LEAD_MS).toBeGreaterThan(0);
  });
});
