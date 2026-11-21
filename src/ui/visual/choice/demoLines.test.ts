import { expect, it, vi } from "vitest";
import { DEMO_LINE_MS, demoClock, demoLines } from "./demoLines";

it("times every word inside its own line and keeps the line text", () => {
  const lines = demoLines(["One two three", "Four"]);
  expect(lines.map((line) => line.fromMs)).toEqual([0, DEMO_LINE_MS]);
  expect(lines[0].words!.map((word) => word.text).join("")).toBe("One two three");
  for (const line of lines) {
    for (const word of line.words!) {
      expect(word.fromMs).toBeGreaterThanOrEqual(line.fromMs);
      expect(word.toMs).toBeLessThanOrEqual(line.toMs);
    }
  }
});

it("loops the clock over all lines", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  const clock = demoClock(2, 0);
  now.mockReturnValue(DEMO_LINE_MS * 2 + 100);
  expect(clock()).toEqual({ atMs: 100, playing: true });
  now.mockRestore();
});
