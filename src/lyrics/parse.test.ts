import { describe, expect, it } from "vitest";
import { parseLyrics } from "./parse";

const lrc = (content: string, trackMs = 200_000) => parseLyrics({ format: "lrc", content }, trackMs);
const spans = (content: string) => lrc(content)?.lines.map((line) => [line.fromMs, line.toMs, line.text]);

describe("parseLyrics", () => {
  it("16 LRC lines start at their stamps and end at the next line", () => {
    const parsed = lrc("[00:01.00]Morning light\n[00:04.50]Over the hill");
    expect(parsed?.lines.map((line) => [line.fromMs, line.toMs, line.text])).toEqual([
      [1000, 4500, "Morning light"],
      [4500, 9500, "Over the hill"],
    ]);
    expect(parsed?.plainText).toBe("Morning light\nOver the hill");
    expect(parsed?.synced).toBe(true);
    expect(parsed?.wordTimed).toBe(false);
  });

  it("the last line ends 5 s after its start, or at the track end when that comes first", () => {
    expect(lrc("[00:01.00]Alone", 3000)?.lines[0].toMs).toBe(3000);
    expect(lrc("[00:01.00]Alone", 0)?.lines[0].toMs).toBe(6000);
  });

  it("17 enhanced LRC gives word timing; the last word ends with its line", () => {
    const parsed = lrc("[00:01.00]<00:01.00>Morning <00:01.60>light");
    expect(parsed?.lines[0].words).toEqual([
      { fromMs: 1000, toMs: 1600, text: "Morning ", background: false },
      { fromMs: 1600, toMs: 6000, text: "light", background: false },
    ]);
    expect(parsed?.wordTimed).toBe(true);
  });

  it("18 TTML paragraphs keep their stated times", () => {
    const ttml =
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.000" end="00:03.000">First line</p><p begin="00:04.000" end="00:06.500">Second line</p></div></body></tt>';
    const parsed = parseLyrics({ format: "ttml", content: ttml }, 200_000);
    expect(parsed?.lines.map((line) => [line.fromMs, line.toMs, line.text])).toEqual([
      [1000, 3000, "First line"],
      [4000, 6500, "Second line"],
    ]);
  });

  it("enhanced LRC: text before the first word stamp stays, timed from the line start", () => {
    const parsed = lrc("[00:03.00]A <00:03.50>b\n[00:05.00]end");
    expect(parsed?.lines[0].words?.map((word) => [word.fromMs, word.toMs, word.text])).toEqual([
      [3000, 3500, "A "],
      [3500, 5000, "b"],
    ]);
  });

  it("enhanced LRC: a closing stamp ends the last word before the line does", () => {
    const parsed = lrc("[00:01.00]<00:01.00>Morning <00:01.60>light <00:02.40>\n[00:03.00]Next");
    expect(parsed?.lines[0].words?.at(-1)).toMatchObject({ fromMs: 1600, toMs: 2400 });
    expect(parsed?.wordTimed).toBe(true);
  });

  it("TTML: translation and romanization rows are not sung words", () => {
    const content = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body dur="00:06.000"><div begin="00:01.000" end="00:06.000">
      <p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:01.500">One</span><span begin="00:01.500" end="00:03.000"> two</span><span ttm:role="x-translation" xml:lang="ru">Раз два</span><span ttm:role="x-roman">Ichi ni</span></p>
      <p begin="00:03.000" end="00:06.000"><span begin="00:03.000" end="00:06.000">Three</span><span ttm:role="x-bg" begin="00:04.000" end="00:05.000"><span begin="00:04.000" end="00:05.000">(ooh)</span><span ttm:role="x-translation">(у)</span></span></p>
    </div></body></tt>`;
    const parsed = parseLyrics({ format: "ttml", content }, 0);
    expect(parsed?.wordTimed).toBe(true);
    expect(parsed?.lines[0].text).toBe("One two");
    expect(parsed?.lines[0].words?.map((word) => [word.fromMs, word.toMs])).toEqual([
      [1000, 1500],
      [1500, 3000],
    ]);
    expect(parsed?.lines[1].words?.map((word) => word.text.trim())).toEqual(["Three", "(ooh)"]);
    expect(parsed?.lines[1].words?.[1].background).toBe(true);
  });

  it("19 plain text has no lines and a trimmed text", () => {
    expect(parseLyrics({ format: "plain", content: "  first\nsecond \n" }, 0)).toEqual({
      lines: [],
      plainText: "first\nsecond",
      synced: false,
      wordTimed: false,
    });
  });

  it("an LRC-format text without stamps is plain", () => {
    expect(lrc("just words\nmore words")).toEqual({ lines: [], plainText: "just words\nmore words", synced: false, wordTimed: false });
  });

  it("20 whitespace only counts as not found", () => {
    expect(lrc(" \n\t")).toBeNull();
    expect(parseLyrics({ format: "plain", content: "   " }, 0)).toBeNull();
  });

  it("21 a line opening with an angle-bracket tag is a companion line without the tag", () => {
    const parsed = lrc("[00:09.00]Main\n[00:10.00]<bg>(ooh)\n[00:12.00]Next");
    expect(parsed?.lines[1]).toMatchObject({ text: "(ooh)", companion: true });
    expect(parsed?.lines[0].companion).toBe(false);
  });

  it("22 a timed empty or note-only line is instrumental and left out of the text", () => {
    const parsed = lrc("[00:01.00]A\n[00:03.00]\n[00:05.00]♪\n[00:08.00]B");
    expect(parsed?.lines.map((line) => line.instrumental)).toEqual([false, true, true, false]);
    expect(parsed?.plainText).toBe("A\nB");
  });

  it("23 lines out of order are sorted by start; equal starts keep file order", () => {
    expect(spans("[00:04.00]B\n[00:01.00]A\n[00:04.00]B2")).toEqual([
      [1000, 4000, "A"],
      [4000, 4000, "B"],
      [4000, 9000, "B2"],
    ]);
  });

  it("a version whose stamps are all zero is plain", () => {
    expect(lrc("[00:00.00]A\n[00:00.00]B")).toEqual({ lines: [], plainText: "A\nB", synced: false, wordTimed: false });
  });

  it("an unknown format or an XML text without lines is not usable", () => {
    expect(parseLyrics({ format: "richsync", content: "[]" }, 0)).toBeNull();
    expect(parseLyrics({ format: "ttml", content: "<tt><body" }, 0)).toBeNull();
  });
});
