import { describe, expect, it } from "vitest";
import { parseLyrics } from "./parse";
import {
  detectFormat,
  editableText,
  endLine,
  firstOpen,
  formatStamp,
  isComplete,
  nudge,
  soundingAt,
  splitWords,
  startSync,
  stretchedToFit,
  tap,
  timedCount,
  toLrc,
  toTtml,
  untap,
  type SyncLine,
  type SyncStep,
  type SyncUnit,
} from "./tapSync";

const START = { line: 0, word: 0 };

function tapAll(lines: SyncLine[], unit: SyncUnit, times: number[]): SyncStep {
  return times.reduce<SyncStep>((step, ms) => tap(step.lines, step.cursor, ms, unit), { lines, cursor: START });
}

describe("tap to sync", () => {
  it("starts from the non-empty lines of plain text, split into words", () => {
    expect(startSync("One two\n\n  Three  \n")).toEqual([
      {
        text: "One two",
        atMs: null,
        endMs: null,
        words: [
          { text: "One ", atMs: null },
          { text: "two", atMs: null },
        ],
      },
      { text: "Three", atMs: null, endMs: null, words: [{ text: "Three", atMs: null }] },
    ]);
  });

  it("splits text without spaces into words and keeps punctuation with them", () => {
    const words = splitWords("\u541b\u306e\u540d\u306f\u3001\u4f55\uff1f");
    expect(words.length).toBeGreaterThan(1);
    expect(words.join("")).toBe("\u541b\u306e\u540d\u306f\u3001\u4f55\uff1f");
  });

  it("a tap per line times the line and moves on, and stops at the end", () => {
    const done = tapAll(startSync("One\nTwo"), "line", [1234.4, 5000]);
    expect(done.lines.map((line) => line.atMs)).toEqual([1234, 5000]);
    expect(done.cursor).toEqual({ line: 2, word: 0 });
    expect(isComplete(done.lines)).toBe(true);
    expect(tap(done.lines, done.cursor, 9000, "line").lines).toBe(done.lines);
  });

  it("a tap per word times the words, the first one also its line", () => {
    const done = tapAll(startSync("One two\nThree"), "word", [1000, 1500, 3000]);
    expect(done.lines[0]).toMatchObject({ atMs: 1000, words: [{ atMs: 1000 }, { atMs: 1500 }] });
    expect(done.lines[1]).toMatchObject({ atMs: 3000, words: [{ atMs: 3000 }] });
    expect(timedCount(done.lines, "word")).toEqual({ done: 3, total: 3 });
    expect(timedCount(startSync("One two\nThree"), "word")).toEqual({ done: 0, total: 3 });
  });

  it("moves the words along when a timed line is tapped again", () => {
    const words = tapAll(startSync("One two"), "word", [1000, 1500]).lines;
    expect(tap(words, START, 2000, "line").lines[0]).toMatchObject({ atMs: 2000, words: [{ atMs: 2000 }, { atMs: 2500 }] });
  });

  it("ends the line sung last, and only after its last word", () => {
    const step = tapAll(startSync("One two\nThree"), "word", [1000, 1500]);
    expect(endLine(step.lines, step.cursor, 2200)[0].endMs).toBe(2200);
    expect(endLine(step.lines, step.cursor, 1400)).toBe(step.lines);
    expect(endLine(startSync("One"), START, 3000)[0].endMs).toBeNull();
  });

  it("takes the last tap back", () => {
    const step = tapAll(startSync("One two\nThree"), "word", [1000, 1500, 3000]);
    const back = untap(step.lines, step.cursor, "word");
    expect(back.cursor).toEqual({ line: 1, word: 0 });
    expect(back.lines[1].atMs).toBeNull();
    expect(untap(back.lines, START, "word").lines).toBe(back.lines);
  });

  it("nudges one word, or a line with its words, and never below zero", () => {
    const lines = tapAll(startSync("One two"), "word", [50, 800]).lines;
    expect(nudge(lines, { line: 0, word: 1 }, 20, "word")[0].words.map((word) => word.atMs)).toEqual([50, 820]);
    expect(nudge(lines, START, -100, "word")[0]).toMatchObject({ atMs: 0, words: [{ atMs: 0 }, { atMs: 800 }] });
    expect(nudge(lines, START, 100, "line")[0]).toMatchObject({ atMs: 150, words: [{ atMs: 150 }, { atMs: 900 }] });
    expect(nudge(startSync("One"), START, 100, "word")[0].atMs).toBeNull();
  });

  it("finds the first open word and what sounds at a moment", () => {
    const { lines } = tapAll(startSync("One two\nThree"), "word", [1000]);
    expect(firstOpen(lines, "word")).toEqual({ line: 0, word: 1 });
    expect(firstOpen(lines, "line")).toEqual({ line: 1, word: 0 });
    expect(soundingAt(lines, 500)).toBeNull();
    expect(soundingAt(lines, 1100)).toEqual({ line: 0, word: 0 });
    const ended = endLine(tapAll(startSync("One"), "word", [1000]).lines, { line: 1, word: 0 }, 2000);
    expect(soundingAt(ended, 2500)).toBeNull();
  });

  it("writes LRC stamps as minutes, seconds and hundredths", () => {
    expect(formatStamp(65_432)).toBe("[01:05.43]");
    const lines = tapAll(startSync("One\nTwo\nThree"), "line", [1000]).lines;
    expect(toLrc(endLine(lines, { line: 1, word: 0 }, 3000))).toBe("[00:01.00] One\n[00:03.00]");
  });

  it("detects LRC by a leading time stamp", () => {
    expect(detectFormat("[00:01.00] One")).toBe("lrc");
    expect(detectFormat("[Verse]\nOne")).toBe("plain");
  });
});

describe("timed lyrics out and back", () => {
  const step = tapAll(startSync("One & two\nThree"), "word", [1000, 1500, 1800, 4000]);
  const lines = endLine(step.lines, step.cursor, 5200);

  it("word LRC reads back to the same times", () => {
    expect(toLrc(lines)).toBe("[00:01.00]<00:01.00>One <00:01.50>& <00:01.80>two\n[00:04.00]<00:04.00>Three<00:05.20>");
    expect(startSync(toLrc(lines))).toEqual(lines);
  });

  it("line LRC with a pause reads back to the same times", () => {
    const timed = endLine(tapAll(startSync("One\nTwo"), "line", [1000]).lines, { line: 1, word: 0 }, 3000);
    const full = tap(timed, { line: 1, word: 0 }, 6000, "line").lines;
    expect(startSync(toLrc(full))).toEqual(full);
  });

  it("TTML reads back to the same words and times", () => {
    const parsed = parseLyrics({ format: "ttml", content: toTtml(lines, 200_000) }, 200_000)!;
    expect(parsed.wordTimed).toBe(true);
    expect(parsed.lines.filter((line) => !line.instrumental).map((line) => [line.text, line.fromMs, line.toMs])).toEqual([
      ["One & two", 1000, 4000],
      ["Three", 4000, 5200],
    ]);
    expect(parsed.lines[0].words!.map((word) => [word.text, word.fromMs])).toEqual([
      ["One ", 1000],
      ["& ", 1500],
      ["two", 1800],
    ]);
  });

  it("line-timed TTML has no spans", () => {
    const timed = tapAll(startSync("One\nTwo"), "line", [1000, 2500]).lines;
    const text = toTtml(timed, 10_000);
    expect(text).toContain('<p begin="00:01.000" end="00:02.500">One</p>');
    expect(text).not.toContain("<span");
  });
});

describe("a found version in the editor", () => {
  it("keeps LRC and plain text as they are", () => {
    expect(editableText({ format: "lrc", content: "[00:01.00]Hi" })).toBe("[00:01.00]Hi");
    expect(editableText({ format: "plain", content: "Hi" })).toBe("Hi");
  });

  it("turns word-timed TTML into LRC with a stamp before every word", () => {
    const ttml =
      '<tt><body><div><p begin="00:01.000" end="00:02.500"><span begin="00:01.000" end="00:01.600">Hi </span><span begin="00:01.600" end="00:02.500">there</span></p></div></body></tt>';
    expect(editableText({ format: "ttml", content: ttml })).toBe("[00:01.00]<00:01.00>Hi <00:01.60>there<00:02.50>");
  });
});

describe("a found version of another speed", () => {
  const lrc = "[ar:LE SSERAFIM]\n[00:10.00]<00:10.00>Crazy <00:11.00>crazy\n[01:00.00]End";

  it("stretches every stamp to the length of a slowed or sped-up stream", () => {
    expect(stretchedToFit(lrc, "crazy (slowed + reverb)", 100_000, 125_000)).toBe("[ar:LE SSERAFIM]\n[00:12.50]<00:12.50>Crazy <00:13.75>crazy\n[01:15.00]End");
    expect(stretchedToFit("[01:00.00]End", "Song (sped up)", 120_000, 96_000)).toBe("[00:48.00]End");
  });

  it("leaves another cut or a near length alone", () => {
    expect(stretchedToFit(lrc, "Crazy (Live)", 100_000, 125_000)).toBe(lrc);
    expect(stretchedToFit(lrc, "Crazy slowed", 100_000, 101_500)).toBe(lrc);
  });
});
