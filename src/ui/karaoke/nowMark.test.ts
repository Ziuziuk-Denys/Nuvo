import { describe, expect, it } from "vitest";
import type { HighlightMode } from "./highlightMode";
import { NowMark, type MarkLine } from "./nowMark";

interface Screen {
  lit: Set<string>;
  filling: Map<string, string>;
}

const screen = (): Screen => ({ lit: new Set(), filling: new Map() });

function element(name: string, on: Screen): HTMLElement {
  return {
    setAttribute: (attribute: string) => {
      if (attribute === "data-nuvo-now") on.lit.add(name);
      else on.filling.set(name, "");
    },
    removeAttribute: (attribute: string) => {
      if (attribute === "data-nuvo-now") on.lit.delete(name);
      else on.filling.delete(name);
    },
    style: {
      setProperty: (_property: string, value: string) => on.filling.set(name, value),
      removeProperty: () => undefined,
    },
  } as unknown as HTMLElement;
}

function line(name: string, on: Screen, words: Array<[string, number, number]>, fromMs?: number, toMs?: number): MarkLine {
  const start = fromMs ?? words[0][1];
  const end = toMs ?? words.at(-1)![2];
  return {
    time: start / 1000,
    duration: (end - start) / 1000,
    lyricElement: element(name, on),
    parts: words.map(([word, from, to]) => ({ time: from / 1000, duration: (to - from) / 1000, lyricElement: element(word, on) })),
  };
}

const mark = (lines: MarkLine[], mode: HighlightMode, reduced = false) => new NowMark(lines, mode, () => reduced);
const ABC: Array<[string, number, number]> = [
  ["a", 1000, 1500],
  ["b", 1500, 2000],
  ["c", 2000, 2500],
];

describe("word", () => {
  it("lights exactly the word being sung, never ahead of it", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "word");
    now.update(999);
    expect([...on.lit]).toEqual([]);
    now.update(1000);
    expect([...on.lit]).toEqual(["a"]);
    now.update(1499);
    expect([...on.lit]).toEqual(["a"]);
    now.update(1500);
    expect([...on.lit]).toEqual(["b"]);
  });

  it("holds over a short gap, lets go in a rest", () => {
    const on = screen();
    const now = mark(
      [
        line("l", on, [
          ["a", 1000, 1400],
          ["b", 1450, 1600],
          ["c", 3000, 3100],
        ]),
      ],
      "word",
    );
    now.update(1430);
    expect([...on.lit]).toEqual(["a"]);
    now.update(1700);
    expect([...on.lit]).toEqual(["b"]);
    now.update(1730);
    expect([...on.lit]).toEqual([]);
  });

  it("a word shorter than a tick still gets its turn, and the mark catches up after it", () => {
    const on = screen();
    const seen: string[] = [];
    const now = mark(
      [
        line("l", on, [
          ["a", 1000, 1010],
          ["b", 1010, 1020],
          ["c", 1020, 1200],
        ]),
      ],
      "word",
    );
    for (const at of [990, 1023, 1056, 1089]) {
      now.update(at);
      seen.push([...on.lit].join());
    }
    expect(seen).toEqual(["", "a", "b", "c"]);
  });

  it("a small step back of the clock never relights an older word", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "word");
    now.update(1510);
    now.update(1520);
    now.update(1495);
    expect([...on.lit]).toEqual(["b"]);
  });

  it("the romanized row under a word-timed line never takes the mark", () => {
    const on = screen();
    const now = mark(
      [
        line(
          "l",
          on,
          [
            ["a", 1000, 1500],
            ["b", 1500, 2000],
            ["romanized", 1000, 2000],
          ],
          1000,
          2000,
        ),
      ],
      "word",
    );
    now.update(1100);
    expect([...on.lit]).toEqual(["a"]);
  });
});

describe("step", () => {
  it("keeps what was sung, in its line only, and lets the line go at its end", () => {
    const on = screen();
    const now = mark([line("one", on, ABC), line("two", on, [["x", 4000, 4500]])], "step");
    now.update(2100);
    expect([...on.lit].sort()).toEqual(["a", "b", "c"]);
    now.update(3000);
    expect([...on.lit]).toEqual([]);
    now.update(4100);
    expect([...on.lit]).toEqual(["x"]);
  });

  it("a seek back un-lights what is ahead of it again", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "step");
    now.update(2100);
    now.update(1200);
    expect([...on.lit]).toEqual(["a"]);
    now.update(500);
    expect([...on.lit]).toEqual([]);
  });
});

describe("fill", () => {
  it("fills the sung word flat and in step with the voice, sung words stay lit", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "fill");
    now.update(1250);
    expect([...on.lit]).toEqual([]);
    expect([...on.filling]).toEqual([["a", "0.5"]]);
    now.update(1750);
    expect([...on.lit]).toEqual(["a"]);
    expect([...on.filling]).toEqual([["b", "0.5"]]);
  });

  it("a seek back takes the fill and the kept words back", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "fill");
    now.update(2250);
    now.update(1250);
    expect([...on.lit]).toEqual([]);
    expect([...on.filling]).toEqual([["a", "0.5"]]);
  });

  it("under reduced motion it steps", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "fill", true);
    now.update(1750);
    expect([...on.lit].sort()).toEqual(["a", "b"]);
    expect(on.filling.size).toBe(0);
  });
});

describe("lines", () => {
  it("a line without word timing lights as one, whatever the mode", () => {
    for (const mode of ["word", "fill", "step"] as const) {
      const on = screen();
      const plain: MarkLine = { time: 1, duration: 2, lyricElement: element("plain", on), parts: [{ time: 1, duration: 0, lyricElement: element("w", on) }] };
      const now = mark([plain], mode, true);
      now.update(1500);
      expect([...on.lit]).toEqual(["plain"]);
    }
  });

  it("line mode lights the line even when it has word timing", () => {
    const on = screen();
    const now = mark([line("l", on, ABC)], "line");
    now.update(1600);
    expect([...on.lit]).toEqual(["l"]);
  });
});
