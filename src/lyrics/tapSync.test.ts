import { describe, expect, it } from "vitest";
import { clearStamp, detectFormat, editableText, formatStamp, isComplete, markEnd, nudge, stamp, startSync, stretchedToFit, toLrc } from "./tapSync";

describe("tap to sync", () => {
  it("starts from the non-empty lines of plain text", () => {
    expect(startSync("One\n\n  Two  \n")).toEqual([
      { text: "One", atMs: null },
      { text: "Two", atMs: null },
    ]);
  });

  it("Space stamps the current line and moves on", () => {
    const first = stamp(startSync("One\nTwo"), 0, 1234.4);
    expect(first.next).toBe(1);
    const second = stamp(first.lines, first.next, 5000);
    expect(second.lines).toEqual([
      { text: "One", atMs: 1234 },
      { text: "Two", atMs: 5000 },
    ]);
    expect(isComplete(second.lines)).toBe(true);
    expect(stamp(second.lines, 2, 9000).lines).toBe(second.lines);
  });

  it("Enter marks where a stamped line ends with an empty stamped line", () => {
    const one = stamp(startSync("One\nTwo"), 0, 1000).lines;
    const ended = markEnd(one, 0, 3000);
    expect(ended.lines).toEqual([
      { text: "One", atMs: 1000 },
      { text: "", atMs: 3000 },
      { text: "Two", atMs: null },
    ]);
    expect(ended.next).toBe(2);
    expect(markEnd(startSync("One"), 0, 3000).lines).toEqual(startSync("One"));
  });

  it("nudges only stamped lines and never below zero; Backspace clears", () => {
    const lines = stamp(startSync("One\nTwo"), 0, 50).lines;
    expect(nudge(lines, 0, -100)[0].atMs).toBe(0);
    expect(nudge(lines, 0, 1000)[0].atMs).toBe(1050);
    expect(nudge(lines, 1, 100)).toBe(lines);
    expect(clearStamp(lines, 0)[0].atMs).toBeNull();
  });

  it("writes LRC stamps as minutes, seconds and hundredths", () => {
    expect(formatStamp(65_432)).toBe("[01:05.43]");
    expect(
      toLrc([
        { text: "One", atMs: 1000 },
        { text: "", atMs: 3000 },
        { text: "Two", atMs: null },
      ]),
    ).toBe("[00:01.00] One\n[00:03.00]");
  });

  it("detects LRC by a leading time stamp", () => {
    expect(detectFormat("[00:01.00] One")).toBe("lrc");
    expect(detectFormat("[Verse]\nOne")).toBe("plain");
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
