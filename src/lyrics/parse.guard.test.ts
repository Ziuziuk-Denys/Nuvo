import { describe, expect, it, vi } from "vitest";

const lyric = (startTimeMs: number, words: string, extra: object = {}) => ({ startTimeMs, durationMs: 0, words, ...extra });
const mocked = vi.hoisted(() => ({ lyrics: [] as unknown[] }));
vi.mock("@braccato/parsers", () => ({
  parseLRC: () => mocked.lyrics,
  parseQRC: () => [],
  parseTTMLContent: () => ({ lyrics: [] }),
}));

const { parseLyrics, MAX_LINES, MAX_LINE_CHARS } = await import("./parse");

describe("parseLyrics input limits", () => {
  it("drops lines whose timestamp is not a finite number", () => {
    mocked.lyrics = [lyric(Number.NaN, "bad"), lyric(2000, "second"), lyric(Number.POSITIVE_INFINITY, "worse"), lyric(1000, "first")];
    const parsed = parseLyrics({ format: "lrc", content: "x" }, 200_000);
    expect(parsed?.lines.map((line) => [line.fromMs, line.toMs, line.text])).toEqual([
      [1000, 2000, "first"],
      [2000, 7000, "second"],
    ]);
  });

  it("ignores word parts with a non-finite start", () => {
    mocked.lyrics = [
      lyric(1000, "a b", {
        parts: [
          { startTimeMs: Number.NaN, durationMs: 100, words: "a " },
          { startTimeMs: 1500, durationMs: 100, words: "b" },
        ],
      }),
    ];
    const words = parseLyrics({ format: "lrc", content: "x" }, 200_000)?.lines[0].words;
    expect(words?.map((word) => [word.fromMs, word.text])).toEqual([
      [1000, "a "],
      [1500, "b"],
    ]);
  });

  it("keeps the first 5000 lines by time and truncates long lines", () => {
    mocked.lyrics = Array.from({ length: MAX_LINES + 10 }, (_, index) => lyric((MAX_LINES + 10 - index) * 1000, "x".repeat(MAX_LINE_CHARS + 50)));
    const parsed = parseLyrics({ format: "lrc", content: "x" }, 0);
    expect(parsed?.lines).toHaveLength(MAX_LINES);
    expect(parsed?.lines[0].fromMs).toBe(1000);
    expect(parsed?.lines[MAX_LINES - 1].fromMs).toBe(MAX_LINES * 1000);
    expect(parsed?.lines[0].text).toHaveLength(MAX_LINE_CHARS);
  });
});
