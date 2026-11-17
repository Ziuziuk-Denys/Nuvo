import { describe, expect, it } from "vitest";
import { paperRows, paperSize } from "./paper";

const measure = (text: string) => text.length * 10;
const words = (text: string) => text.split(" ");

describe("paper rows", () => {
  it("holds at most three words per row", () => {
    const rows = paperRows(words("pour a glass and bite my tongue"), true, 1000, measure);
    expect(rows.map((row) => row.words.map((w) => w.text).join(" "))).toEqual(["pour a glass", "and bite my", "tongue"]);
  });

  it("justifies every row but the last once the phrase is complete", () => {
    const rows = paperRows(words("pour a glass and bite my tongue"), true, 1000, measure);
    const right = (row: (typeof rows)[number]) => row.words.at(-1)!.x + measure(row.words.at(-1)!.text);
    expect(rows[0].words[0].x).toBeCloseTo(125);
    expect(right(rows[0])).toBeCloseTo(875);
    expect(right(rows[1])).toBeCloseTo(875);
    expect(rows[2].words[0].x).toBeCloseTo(125);
    expect(right(rows[2])).toBeLessThan(875);
  });

  it("keeps half-em spacing and centres the block while the phrase is still sung", () => {
    const rows = paperRows(words("you say i'm the"), false, 1000, measure, 72);
    const first = rows[0].words;
    expect(first[1].x - (first[0].x + measure(first[0].text))).toBeCloseTo(36);
    const widest = Math.max(...rows.map((row) => row.words.at(-1)!.x + measure(row.words.at(-1)!.text) - row.words[0].x));
    expect(first[0].x).toBeCloseTo((1000 - widest) / 2);
    expect(rows[1].words[0].x).toBeCloseTo(first[0].x);
  });

  it("justifies a two-word row across the measure when it is not the last", () => {
    const rows = paperRows(words("i'm here say my name"), true, 1000, measure);
    expect(rows[0].words).toHaveLength(3);
    const two = paperRows(words("oh no oh no"), true, 1000, measure, 72, 2);
    expect(two[0].words[1].x + measure(two[0].words[1].text)).toBeCloseTo(875);
  });

  it("starts a new row when three words would not fit, so justified words never overlap", () => {
    const rows = paperRows(words("unbelievable everything sometimes yes"), true, 500, measure, 72);
    for (const row of rows) {
      for (let i = 1; i < row.words.length; i++) expect(row.words[i].x).toBeGreaterThan(row.words[i - 1].x + measure(row.words[i - 1].text));
      const right = row.words.at(-1)!.x + measure(row.words.at(-1)!.text);
      expect(right).toBeLessThanOrEqual(500 * 0.875 + 0.001);
    }
  });

  it("never starts a sung block left of the margin", () => {
    const rows = paperRows(words("unbelievable everything sometimes"), false, 500, measure, 72);
    expect(Math.min(...rows.map((row) => row.words[0].x))).toBeGreaterThanOrEqual(500 * 0.125 - 0.001);
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
