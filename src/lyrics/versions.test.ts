import { describe, expect, it } from "vitest";
import { ENHANCED, LRC_TWO, PLAIN_TWO, found, notFound } from "./test/events";
import { MAX_CONTENT_BYTES, addEntry, toEntry, toVersion, type Entry } from "./versions";
import type { StreamEvent } from "./types";

function rank(events: StreamEvent[]): string[] {
  let entries: Entry[] = [];
  events.forEach((event, order) => {
    const entry = toEntry(event, order, 200_000);
    if (entry) entries = addEntry(entries, entry);
  });
  return entries.map((entry) => entry.candidate.provider);
}

describe("versions", () => {
  it("3 a better synced version ranks above an earlier plain one", () => {
    expect(rank([found("plainsrc", PLAIN_TWO, { format: "plain", quality: 0.5 }), found("syncsrc", LRC_TWO, { quality: 0.8 })])).toEqual([
      "syncsrc",
      "plainsrc",
    ]);
  });

  it("4 real word timing outranks quality", () => {
    expect(rank([found("lrclib", LRC_TWO, { quality: 0.8 }), found("words", ENHANCED, { quality: 0.55, syncLevel: "word_level" })])).toEqual([
      "words",
      "lrclib",
    ]);
  });

  it("a word-level claim without word stamps in the text does not rank as word timed", () => {
    expect(rank([found("good", LRC_TWO, { quality: 0.8 }), found("claims", LRC_TWO, { quality: 0.6, syncLevel: "word_level" })])).toEqual(["good", "claims"]);
  });

  it("word timing found in a text marked line level ranks first too", () => {
    expect(rank([found("lines", LRC_TWO, { quality: 0.8 }), found("tagged", ENHANCED, { quality: 0.7 })])).toEqual(["tagged", "lines"]);
  });

  it("the user's lines still beat word timing", () => {
    expect(rank([found("words", ENHANCED, { quality: 0.9, syncLevel: "word_level" }), found("user", LRC_TWO, { quality: 0.3, topPriority: true })])).toEqual([
      "user",
      "words",
    ]);
  });

  it("5 user lyrics come first even with lower quality", () => {
    expect(rank([found("lrclib", LRC_TWO, { quality: 0.9 }), found("user", LRC_TWO, { quality: 0.3, topPriority: true })])).toEqual(["user", "lrclib"]);
  });

  it("equal quality: deeper sync first, then arrival", () => {
    expect(
      rank([found("a", LRC_TWO, { quality: 0.7 }), found("b", ENHANCED, { quality: 0.7, syncLevel: "syllable_level" }), found("c", LRC_TWO, { quality: 0.7 })]),
    ).toEqual(["b", "a", "c"]);
  });

  it("a second found from one provider replaces the first", () => {
    const first = toEntry(found("lrclib", PLAIN_TWO, { format: "plain", quality: 0.5 }), 0, 200_000);
    const second = toEntry(found("lrclib", LRC_TWO, { quality: 0.8 }), 1, 200_000);
    if (!first || !second) throw new Error("both entries are usable");
    const entries = addEntry(addEntry([], first), second);
    expect(entries).toHaveLength(1);
    expect(entries[0].parsed.synced).toBe(true);
  });

  it("ignores not found, errors and empty texts", () => {
    expect(toEntry(notFound("lrclib"), 0, 0)).toBeNull();
    expect(toEntry({ type: "provider", provider: "lrclib", status: "error", message: "down" }, 0, 0)).toBeNull();
    expect(toEntry(found("lrclib", "  \n "), 0, 0)).toBeNull();
  });

  it("RF5 ignores a candidate over 256 KB", () => {
    const huge = `[00:01.00]${"a".repeat(MAX_CONTENT_BYTES)}`;
    expect(rank([found("big", huge, { quality: 0.99 }), found("lrclib", LRC_TWO, { quality: 0.8 })])).toEqual(["lrclib"]);
  });

  it("a version carries the daemon's label or none", () => {
    const entry = toEntry(found("lrclib", LRC_TWO, { quality: 0.8 }), 0, 200_000);
    if (!entry) throw new Error("usable");
    expect(toVersion(entry)).toEqual({ provider: "lrclib", label: null, syncLevel: "line_level", quality: 0.8, topPriority: false });
  });

  it("word timing is only what the source gave: a line-synced version stays line-timed", () => {
    const lines = toEntry(found("lrclib", LRC_TWO, { quality: 0.8 }), 0, 200_000);
    const words = toEntry(found("words", ENHANCED, { quality: 0.8, syncLevel: "word_level" }), 0, 200_000);
    if (!lines || !words) throw new Error("usable");
    expect(lines.parsed.lines[0].words).toBeUndefined();
    expect(lines.parsed.wordTimed).toBe(false);
    expect(words.parsed.wordTimed).toBe(true);
  });
});
