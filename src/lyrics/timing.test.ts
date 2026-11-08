import { describe, expect, it } from "vitest";
import { activeLine, clampOffset, leadStarts, shiftLines } from "./timing";
import type { Line } from "./types";

const line = (fromMs: number, extra: Partial<Line> = {}): Line => ({
  fromMs,
  toMs: fromMs + 1000,
  text: `at ${fromMs}`,
  companion: false,
  instrumental: false,
  ...extra,
});
const at = (lines: Line[], positionMs: number) => activeLine(lines, leadStarts(lines), positionMs);

describe("offsets", () => {
  it("24 shifts every line and restores the original at 0", () => {
    const lines = [line(1000), line(4500)];
    expect(shiftLines(lines, 500).map((l) => l.fromMs)).toEqual([1500, 5000]);
    expect(shiftLines(lines, -2000).map((l) => l.fromMs)).toEqual([0, 2500]);
    expect(shiftLines(lines, 0)).toBe(lines);
    expect(lines.map((l) => l.fromMs)).toEqual([1000, 4500]);
  });

  it("a negative offset floors the first lines at 0 and keeps their order", () => {
    expect(shiftLines([line(100), line(300), line(5000)], -1000).map((l) => [l.fromMs, l.toMs])).toEqual([
      [0, 100],
      [0, 300],
      [4000, 5000],
    ]);
  });

  it("25 moves every word start and end by the same amount, floored at 0", () => {
    const words = [
      { fromMs: 1000, toMs: 1600, text: "Morning ", background: false },
      { fromMs: 1600, toMs: 2000, text: "light", background: false },
    ];
    expect(shiftLines([line(1000, { words })], 300)[0].words).toEqual([
      { fromMs: 1300, toMs: 1900, text: "Morning ", background: false },
      { fromMs: 1900, toMs: 2300, text: "light", background: false },
    ]);
    expect(shiftLines([line(1000, { words })], -1700)[0].words?.map((w) => [w.fromMs, w.toMs])).toEqual([
      [0, 0],
      [0, 300],
    ]);
  });

  it("27 clamps to the range and rounds", () => {
    expect(clampOffset(45_000)).toBe(30_000);
    expect(clampOffset(-45_000)).toBe(-30_000);
    expect(clampOffset(12.6)).toBe(13);
    expect(clampOffset(-0.3)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});

describe("active line", () => {
  it("30 a line leads by 600 ms", () => {
    const lines = [line(1000), line(4500), line(9000)];
    expect([300, 400, 3899, 3900].map((ms) => at(lines, ms))).toEqual([null, 0, 0, 1]);
  });

  it("31 the lead never starts before the previous line's last word ends", () => {
    const words = [{ fromMs: 3000, toMs: 4200, text: "end", background: false }];
    const lines = [line(1000, { words }), line(4500)];
    expect(at(lines, 3950)).toBe(0);
    expect(at(lines, 4200)).toBe(1);
  });

  it("32 a companion line is never active; it shows with the line before it", () => {
    const lines = [line(1000), line(2000, { companion: true }), line(4000)];
    const seen = new Set<number | null>();
    for (let ms = 0; ms <= 6000; ms += 50) seen.add(at(lines, ms));
    expect([...seen]).toEqual([null, 0, 2]);
  });

  it("identical stamps (duet LRC): the last of them is active", () => {
    const lines = [line(1000), line(5000), line(5000), line(5000)];
    expect(at(lines, 5000)).toBe(3);
  });

  it("35 2,000 lines: one evaluation stays well under 0.1 ms", () => {
    const lines = Array.from({ length: 2000 }, (_, index) => line(index * 2000));
    const leads = leadStarts(lines);
    const runs = 10_000;
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) activeLine(lines, leads, (index * 397) % 4_000_000);
    expect((performance.now() - started) / runs).toBeLessThan(0.1);
  });
});
