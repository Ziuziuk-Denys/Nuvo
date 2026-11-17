import { describe, expect, it } from "vitest";
import type { Line } from "@/lyrics";
import type { LyricStyle, Voice } from "../template/schema";
import { estimateWords, layoutWords, lineWords, visibleWords, type Box, type Measure } from "./layout";

const SANS: Voice = { family: "condensed", weight: 700, italic: false, upper: false };
const SERIF: Voice = { family: "serif", weight: 300, italic: true, upper: false };
const measure: Measure = (text, size) => text.length * size * 0.5;
const BOX: Box = { x: 0, y: 0, width: 400, height: 400 };

function style(overrides: Partial<LyricStyle> = {}): LyricStyle {
  return { mode: "stack", voices: [SANS], size: 40, leading: 1.1, align: "justify", motion: "cut", ...overrides };
}

function line(text: string, fromMs: number, toMs: number): Line {
  return { text, fromMs, toMs, companion: false, instrumental: false };
}

describe("word estimate", () => {
  it("spreads a line's words over its time by syllables", () => {
    const words = estimateWords(line("say my beautiful name", 1000, 3000));
    expect(words.map((word) => word.text.trim())).toEqual(["say", "my", "beautiful", "name"]);
    expect(words[0].fromMs).toBe(1000);
    expect(words.at(-1)!.toMs).toBe(3000);
    const length = (i: number) => words[i].toMs - words[i].fromMs;
    expect(length(2)).toBeGreaterThan(length(0) * 2);
  });

  it("sings a short line quickly and holds the last word through a long pause", () => {
    const words = estimateWords(line("I wanted to see the world", 1000, 6000));
    expect(words.at(-1)!.fromMs).toBeLessThan(3500);
    expect(words.at(-1)!.toMs).toBe(6000);
  });

  it("keeps real word timing when the line has it", () => {
    const timed: Line = {
      ...line("a b", 0, 1000),
      words: [
        { text: "a ", fromMs: 0, toMs: 200, background: false },
        { text: "b", fromMs: 700, toMs: 1000, background: false },
      ],
    };
    expect(estimateWords(timed).map((word) => word.fromMs)).toEqual([0, 700]);
  });
});

describe("visible words", () => {
  const lines = [line("you say", 1000, 2000), line("then why you running", 2500, 4500)];

  it("shows words only once they are sung", () => {
    expect(visibleWords(lines, 1100).map((word) => word.text.trim())).toEqual(["you"]);
  });

  it("clears the block when the next phrase starts", () => {
    const shown = visibleWords(lines, 2600).map((word) => word.text.trim());
    expect(shown).toEqual(["then"]);
  });

  it("clears after a long gap", () => {
    expect(visibleWords([line("you say", 1000, 2000)], 3500)).toEqual([]);
  });

  it("reports how long each word has been on screen", () => {
    const [first] = visibleWords(lines, 1300);
    expect(first.age).toBe(300);
  });
});

describe("line words", () => {
  const lines = [line("day off in kyoto", 1000, 3000), line("got bored", 3200, 4000)];

  it("shows the whole current line at once", () => {
    expect(lineWords(lines, 1100).map((word) => word.text.trim())).toEqual(["day", "off", "in", "kyoto"]);
  });

  it("ages every word from the line start", () => {
    expect(lineWords(lines, 1100).every((word) => word.age === 100)).toBe(true);
  });

  it("shows nothing before the first line", () => {
    expect(lineWords(lines, 500)).toEqual([]);
  });
});

describe("word layout", () => {
  const word = (text: string) => ({ text, fromMs: 0, toMs: 0, age: 0 });

  it("justifies full rows and leaves the open row left aligned", () => {
    const words = ["then", "why", "you", "running", "you", "running"].map(word);
    const runs = layoutWords(words, BOX, measure, style());
    const rows = new Map<number, typeof runs>();
    for (const run of runs) rows.set(run.y, [...(rows.get(run.y) ?? []), run]);
    const [first, last] = [...rows.values()];
    const end = (r: (typeof runs)[number]) => r.x + measure(r.text, r.size, SANS);
    expect(end(first.at(-1)!)).toBeCloseTo(BOX.width);
    expect(last[0].x).toBe(0);
    expect(end(last.at(-1)!)).toBeLessThan(BOX.width);
  });

  it("centres every row when asked", () => {
    const runs = layoutWords([word("say"), word("my")], BOX, measure, style({ align: "centre" }));
    const left = runs[0].x;
    const right = runs[1].x + measure(runs[1].text, runs[1].size, SANS);
    expect(left).toBeCloseTo(BOX.width - right);
  });

  it("shrinks a word wider than the box", () => {
    const [run] = layoutWords([word("incomprehensibilities")], { ...BOX, width: 200 }, measure, style());
    expect(measure(run.text, run.size, SANS)).toBeLessThanOrEqual(200);
  });

  it("shrinks the block until it fits the box height", () => {
    const words = Array.from({ length: 60 }, () => word("again"));
    const runs = layoutWords(words, BOX, measure, style());
    const bottom = Math.max(...runs.map((run) => run.y));
    expect(bottom).toBeLessThanOrEqual(BOX.height);
  });

  it("gives short words the second voice", () => {
    const runs = layoutWords([word("i"), word("hope"), word("you")], BOX, measure, style({ voices: [SANS, SERIF] }));
    expect(runs.map((run) => run.voice)).toEqual([1, 0, 1]);
  });

  it("upper-cases a voice that asks for it", () => {
    const [run] = layoutWords([word("sleep")], BOX, measure, style({ voices: [{ ...SANS, upper: true }] }));
    expect(run.text).toBe("SLEEP");
  });

  it("sets one word as large as the box allows in single mode", () => {
    const [run] = layoutWords([word("alone")], BOX, measure, style({ mode: "single", size: 1000 }));
    expect(measure(run.text, run.size, SANS)).toBeCloseTo(BOX.width);
  });
});
