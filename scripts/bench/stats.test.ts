import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper without declarations
import { frameStats, markdownTable, median, parseStat, percentile, readKb, summarize, toneWav } from "./stats.mjs";

describe("bench stats", () => {
  it("takes the median and the nearest-rank percentile", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([7], 95)).toBe(7);
  });

  it("summarizes runs and returns null for none", () => {
    expect(summarize([10, 20, 30, 40, 50])).toEqual({ n: 5, p50: 30, p95: 50, min: 10, max: 50 });
    expect(summarize([])).toBeNull();
  });

  it("reads a kB field from smaps_rollup", () => {
    const text = "Rss:  1024 kB\nPss:   512 kB\nPss_Anon:  100 kB\n";
    expect(readKb(text, "Pss")).toBe(512);
    expect(readKb(text, "Missing")).toBe(0);
  });

  it("parses /proc stat with spaces in the command name", () => {
    const fields = Array.from({ length: 40 }, (_, i) => String(i));
    // after ") " the first field is the state (index 0), the parent pid is index 1, utime 11, stime 12
    const after = ["S", "42", ...fields.slice(2)].map((v, i) => (i === 11 ? "7" : i === 12 ? "5" : v));
    expect(parseStat(`123 (nuvo core) ${after.join(" ")}`)).toEqual({ parent: 42, ticks: 12 });
  });

  it("counts frames over 20 ms", () => {
    const stats = frameStats([16.6, 16.7, 16.6, 33.4]);
    expect(stats.frames).toBe(4);
    expect(stats.slowShare).toBe(0.25);
    expect(stats.worst).toBe(33.4);
  });

  it("builds a valid WAV of the asked length", () => {
    const wav = toneWav(2, 8000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(40)).toBe(2 * 8000 * 2);
    expect(wav.length).toBe(44 + 2 * 8000 * 2);
  });

  it("renders skipped and empty rows", () => {
    const table = markdownTable([
      ["a", "ms", summarize([1, 2, 3])],
      ["b", "ms", "skipped"],
      ["c", "ms", null],
    ]);
    expect(table).toContain("| a | ms | 3 | 2 | 3 | 1-3 |");
    expect(table).toContain("| b | ms | - | skipped | - | - |");
    expect(table).toContain("| c | ms | 0 | not measured | - | - |");
  });
});
