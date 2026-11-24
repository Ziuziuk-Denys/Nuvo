import { expect, it, vi } from "vitest";

vi.stubGlobal("Path2D", class {});
const { fitText, wrapText } = await import("./replayImage");

const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics };

it("cuts a long title with an ellipsis and leaves a short one alone", () => {
  expect(fitText(ctx, "Short", 100)).toBe("Short");
  expect(fitText(ctx, "A very long song title", 100)).toBe("A very lo…");
});

it("wraps to the given lines and cuts the rest", () => {
  expect(wrapText(ctx, "one two three", 80, 2)).toEqual(["one two", "three"]);
  expect(wrapText(ctx, "one two three four five six", 80, 2)).toEqual(["one two", "three f…"]);
});
