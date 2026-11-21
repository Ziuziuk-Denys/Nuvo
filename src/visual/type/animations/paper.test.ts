import { describe, expect, it } from "vitest";
import type { Line } from "@/lyrics";
import type { Ctx } from "./kit";
import { paper, paperRows, paperSize } from "./paper";

const measure = (text: string) => text.length * 10;
const words = (text: string) => text.split(" ");

describe("paper rows", () => {
  it("holds at most three words per row", () => {
    const rows = paperRows(words("pour a glass and bite my tongue"), 1000, measure);
    expect(rows.map((row) => row.words.map((w) => w.text).join(" "))).toEqual(["pour a glass", "and bite my", "tongue"]);
  });

  it("justifies every row but the last", () => {
    const rows = paperRows(words("pour a glass and bite my tongue"), 1000, measure);
    const right = (row: (typeof rows)[number]) => row.words.at(-1)!.x + measure(row.words.at(-1)!.text);
    expect(rows[0].words[0].x).toBeCloseTo(125);
    expect(right(rows[0])).toBeCloseTo(875);
    expect(right(rows[1])).toBeCloseTo(875);
    expect(rows[2].words[0].x).toBeCloseTo(125);
    expect(right(rows[2])).toBeLessThan(875);
  });

  it("justifies a two-word row across the measure when it is not the last", () => {
    const rows = paperRows(words("i'm here say my name"), 1000, measure);
    expect(rows[0].words).toHaveLength(3);
    const two = paperRows(words("oh no oh no"), 1000, measure, 72, 2);
    expect(two[0].words[1].x + measure(two[0].words[1].text)).toBeCloseTo(875);
  });

  it("starts a new row when three words would not fit, so justified words never overlap", () => {
    const rows = paperRows(words("unbelievable everything sometimes yes"), 500, measure, 72);
    for (const row of rows) {
      for (let i = 1; i < row.words.length; i++) expect(row.words[i].x).toBeGreaterThan(row.words[i - 1].x + measure(row.words[i - 1].text));
      const right = row.words.at(-1)!.x + measure(row.words.at(-1)!.text);
      expect(right).toBeLessThanOrEqual(500 * 0.875 + 0.001);
    }
  });
});

describe("paper size", () => {
  it("shrinks the type until the longest word and every row fit the frame", () => {
    const narrow = paperSize(words("невероятно"), 300, 960, (text, px) => text.length * px * 0.55, 72);
    expect(narrow).toBeLessThan(72);
    expect("невероятно".length * narrow * 0.55).toBeLessThanOrEqual(300 * 0.75 + 0.001);
    const short = paperSize(words("невероятно каждую ночь и каждый день невероятно"), 540, 400, (text, px) => text.length * px * 0.55, 72);
    expect(short).toBeLessThan(72);
  });

  it("keeps the full size when everything fits", () => {
    expect(paperSize(words("pour a glass"), 1080, 1920, (text, px) => text.length * px * 0.5, 135)).toBe(135);
  });
});

describe("paper drawing", () => {
  function drawn(nowMs: number): Map<string, number> {
    const xs = new Map<string, number>();
    const ctx = {
      font: "",
      fillStyle: "",
      globalAlpha: 1,
      measureText: (text: string) => ({ width: text.length * 40 }),
      fillText: (text: string, x: number) => xs.set(text, x),
    } as unknown as Ctx;
    const lines: Line[] = [{ text: "pour a glass and bite my tongue", fromMs: 0, toMs: 3000, companion: false, instrumental: false }];
    paper.draw({
      ctx,
      lines,
      nowMs,
      width: 1080,
      height: 1920,
      box: { x: 0, y: 0, width: 1080, height: 1920 },
      pulse: { cuts: 0, cutAgeMs: 0, drive: 0, onset: 0, level: 0 },
    });
    return xs;
  }

  it("keeps every word where it first appears until the line is over", () => {
    const early = drawn(10);
    const late = drawn(3500);
    expect(early.get("pour")).toBeDefined();
    expect(late.get("pour")).toBeCloseTo(early.get("pour")!);
    const middle = drawn(1500);
    for (const [text, x] of middle) expect(late.get(text)).toBeCloseTo(x);
  });
});

describe("paper frame", () => {
  const sizes: [number, number][] = [
    [1100, 705],
    [1650, 1058],
    [1920, 1080],
    [2560, 1440],
    [720, 1280],
    [1080, 1920],
    [1080, 1080],
  ];
  const lyrics: Line[] = [
    { text: "Говорит, как нужна, и без меня", fromMs: 0, toMs: 3000, companion: false, instrumental: false },
    { text: "достопримечательности невероятно", fromMs: 3000, toMs: 6000, companion: false, instrumental: false },
  ];

  it("keeps every Russian word inside the frame at every window size and export shape", () => {
    for (const [width, height] of sizes) {
      for (const nowMs of [2900, 5900]) {
        const spans: { text: string; left: number; right: number }[] = [];
        let px = 0;
        const ctx = {
          set font(value: string) {
            px = Number(/([\d.]+)px/.exec(value)![1]);
          },
          get font() {
            return `${px}px`;
          },
          fillStyle: "",
          globalAlpha: 1,
          measureText: (text: string) => ({ width: text.length * px * 0.58 }),
          fillText: (text: string, x: number) => spans.push({ text, left: x, right: x + text.length * px * 0.58 }),
        } as unknown as Ctx;
        paper.draw({
          ctx,
          lines: lyrics,
          nowMs,
          width,
          height,
          box: { x: 0, y: 0, width, height },
          pulse: { cuts: 0, cutAgeMs: 0, drive: 0, onset: 0, level: 0 },
        });
        expect(spans.length).toBeGreaterThan(0);
        for (const span of spans) {
          expect(span.left, `${span.text} in ${width}x${height}`).toBeGreaterThanOrEqual(0);
          expect(span.right, `${span.text} in ${width}x${height}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
