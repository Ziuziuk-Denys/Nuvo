import { describe, expect, it } from "vitest";
import { activeLineIndex, formatTime, msUntilNextLine, positionAt } from "./playback";

const lines = [
  { timeMs: 1000, text: "a" },
  { timeMs: 3000, text: "b" },
  { timeMs: 6000, text: "c" },
];

describe("playback helpers", () => {
  it("interpolates only while playing and clamps to the duration", () => {
    const sample = { positionMs: 1000, sampledAt: 10_000, playing: true, durationMs: 2000 };
    expect(positionAt(sample, 10_500)).toBe(1500);
    expect(positionAt(sample, 99_000)).toBe(2000);
    expect(positionAt({ ...sample, playing: false }, 10_500)).toBe(1000);
    expect(positionAt(sample, 9_000)).toBe(1000);
  });

  it("finds the active line", () => {
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 5999)).toBe(1);
    expect(activeLineIndex(lines, 60_000)).toBe(2);
    expect(activeLineIndex([], 5)).toBe(-1);
  });

  it("arms one timer for the next line", () => {
    expect(msUntilNextLine(lines, 0)).toBe(1000);
    expect(msUntilNextLine(lines, 2990)).toBe(16);
    expect(msUntilNextLine(lines, 6500)).toBeNull();
  });

  it("formats times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(61_900)).toBe("1:01");
    expect(formatTime(-5)).toBe("0:00");
  });

  it("formatTime(NaN) is 0:00", () => {
    expect(formatTime(NaN)).toBe("0:00");
  });
});
