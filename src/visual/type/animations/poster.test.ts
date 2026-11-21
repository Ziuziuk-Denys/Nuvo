import { describe, expect, it } from "vitest";
import type { Line } from "@/lyrics";
import type { Box } from "../layout";
import { posterMarks, posterPhrases, type Mark } from "./poster";

const measure = (text: string, size: number) => text.length * size * 0.5;

function line(text: string, fromMs: number, toMs: number): Line {
  return { text, fromMs, toMs, companion: false, instrumental: false };
}

function frameOf(width: number, height: number): { frame: { width: number; height: number }; box: Box } {
  return { frame: { width, height }, box: { x: width * 0.08, y: height * 0.38, width: width * 0.84, height: height * 0.24 } };
}

function afterIntro(text: string, fromMs: number, toMs: number): Line[] {
  return [line("intro", fromMs - 2000, fromMs - 1000), line(text, fromMs, toMs)];
}

const tall = frameOf(1080, 1920);
const marks = (lines: Line[], nowMs: number, at = tall) => posterMarks(lines, nowMs, at.box, at.frame, measure);
const texts = (found: Mark[]) => found.filter((mark) => !mark.echo).map((mark) => mark.text);

function inside(mark: Mark, box: Box): boolean {
  const halfHeight = (mark.size * mark.stretch) / 2;
  return (
    mark.x - mark.width / 2 >= box.x - 0.5 &&
    mark.x + mark.width / 2 <= box.x + box.width + 0.5 &&
    mark.y - halfHeight >= box.y - 0.5 &&
    mark.y + halfHeight <= box.y + box.height + 0.5
  );
}

describe("poster phrases", () => {
  const phrases = (text: string, toMs: number, index = 0) => posterPhrases(line(text, 0, toMs), index);
  const words = (found: ReturnType<typeof posterPhrases>) => found.map((phrase) => phrase.words.map((word) => word.text.trim()).join(" "));

  it("splits a line at punctuation and into even phrases of at most four words", () => {
    expect(words(phrases("i don't know how we ended up here again, tonight", 6000))).toEqual(["i don't know", "how we ended", "up here again,", "tonight"]);
  });

  it("alternates capitals and italics between phrases and between lines", () => {
    const first = phrases("keep the porch light burning, for one more night", 6000);
    expect(words(first)).toEqual(["keep the porch", "light burning,", "for one more night"]);
    expect(first.map((phrase) => phrase.soft)).toEqual([true, false, true]);
    expect(phrases("your problem", 1600, 0)[0].soft).toBe(true);
    expect(phrases("your problem", 1600, 1)[0].soft).toBe(false);
  });

  it("keeps a single word and a rushed phrase in capitals", () => {
    expect(phrases("soul", 2000, 0)[0].soft).toBe(false);
    expect(phrases("so unlikable", 300, 0)[0].soft).toBe(false);
  });
});

describe("proportions", () => {
  it("sizes capitals, italics and the echo against the frame like the reference", () => {
    const unit = 1080;
    const caps = Array.from({ length: 12 }, (_, i) => marks([line("try", i * 1000, i * 1000 + 300)], i * 1000 + 10)[0].size / unit);
    expect(Math.min(...caps)).toBeCloseTo(0.104, 2);
    expect(Math.max(...caps)).toBeCloseTo(0.167, 2);
    expect(marks([line("your problem", 3000, 4600)], 3010)[0].size / unit).toBeCloseTo(0.095, 3);
  });
});

describe("caps", () => {
  const lines = afterIntro("try to eat sorrow", 3000, 4600);

  it("shows only the word being sung, in capitals", () => {
    expect(texts(marks(lines, 3050))).toEqual(["TRY"]);
    expect(texts(marks(lines, 4590))).toEqual(["SORROW"]);
  });

  it("punches a held word to the other size halfway through it", () => {
    const words = [{ text: "soul", fromMs: 1000, toMs: 2000, background: false }];
    const held = [{ ...line("soul", 1000, 2000), words }];
    const early = marks(held, 1100)[0].size;
    const late = marks(held, 1900)[0].size;
    expect(late).not.toBeCloseTo(early);
  });

  it("keeps a quick word at one size", () => {
    const words = [
      { text: "to ", fromMs: 1000, toMs: 1200, background: false },
      { text: "eat", fromMs: 1200, toMs: 1600, background: false },
    ];
    const quick = [line("intro", 0, 500), { ...line("to eat", 1000, 1600), words }];
    expect(marks(quick, 1190)[0].size).toBeCloseTo(marks(quick, 1010)[0].size);
  });

  it("stretches short words tall and leaves long words as they are", () => {
    const short = Array.from({ length: 12 }, (_, i) => marks([line("off", i * 1000, i * 1000 + 900)], i * 1000 + 10)[0]);
    const tallOnes = short.filter((mark) => mark.stretch > 1);
    expect(tallOnes.length).toBeGreaterThan(0);
    expect(tallOnes[0].squeeze).toBeLessThan(short.find((mark) => mark.stretch === 1)?.squeeze ?? 1);
    const long = marks([line("unlikable", 0, 900)], 10)[0];
    expect(long.stretch).toBe(1);
  });
});

describe("soft", () => {
  it("adds words one by one on a centred row with even gaps", () => {
    const lines = [line("for just this", 3000, 4800)];
    expect(texts(marks(lines, 3010))).toEqual(["for"]);
    const row = marks(lines, 4790).filter((mark) => !mark.echo);
    expect(row.map((mark) => mark.text)).toEqual(["for", "just", "this"]);
    expect(new Set(row.map((mark) => mark.y)).size).toBe(1);
    const left = (mark: Mark) => mark.x - mark.width / 2;
    const right = (mark: Mark) => mark.x + mark.width / 2;
    expect((left(row[0]) + right(row[2])) / 2).toBeCloseTo(tall.box.x + tall.box.width / 2);
    expect(left(row[1]) - right(row[0])).toBeCloseTo(left(row[2]) - right(row[1]));
    expect(left(row[1]) - right(row[0])).toBeCloseTo(row[0].size * 1.25);
  });

  it("wraps a four-word line into two justified rows of two", () => {
    const grid = marks([line("how can you be", 3000, 5400)], 5390).filter((mark) => !mark.echo);
    expect(grid.map((mark) => mark.text)).toEqual(["how", "can", "you", "be"]);
    const left = (mark: Mark) => mark.x - mark.width / 2;
    const right = (mark: Mark) => mark.x + mark.width / 2;
    expect(left(grid[2])).toBeCloseTo(left(grid[0]));
    expect(Math.max(right(grid[1]), right(grid[3]))).toBeCloseTo(Math.min(right(grid[1]), right(grid[3])));
    expect(grid[2].y - grid[0].y).toBeCloseTo(grid[0].size * 1.4);
  });

  it("puts a big echo of the longest word behind most complete italic phrases and none before the phrase is complete", () => {
    const echoes = Array.from({ length: 16 }, (_, i) => {
      const start = 3000 + i * 3000;
      const lines = [line("sleep alone", start, start + 1600)];
      expect(marks(lines, start + 10).some((mark) => mark.echo)).toBe(false);
      return marks(lines, start + 1590);
    });
    const withEcho = echoes.filter((found) => found[0].echo);
    expect(withEcho.length).toBeGreaterThan(echoes.length / 2);
    expect(withEcho.length).toBeLessThan(echoes.length);
    expect(withEcho[0][0].text).toBe("ALONE");
    expect(withEcho[0][0].size).toBeGreaterThan(withEcho[0][1].size * 2);
  });
});

describe("bounds", () => {
  const frames = [tall, frameOf(1920, 1080), frameOf(1080, 1080), frameOf(300, 900), frameOf(900, 160)];
  const lyrics = [
    line("incomprehensibilities", 0, 900),
    line("антиконституционность", 1000, 1900),
    line("off", 2000, 2900),
    line("wonderful extraordinary", 3000, 6000),
    line("unbelievably beautiful everlasting", 6000, 9000),
    line("невероятно красивая бесконечность, навсегда", 9000, 12000),
  ];

  it("keeps every word inside the lyric box and every echo inside the frame, at any size and aspect", () => {
    for (const at of frames) {
      for (let nowMs = 0; nowMs < 13_000; nowMs += 50) {
        for (const mark of marks(lyrics, nowMs, at)) {
          const area = mark.echo ? { x: 0, y: 0, ...at.frame } : at.box;
          expect(inside(mark, area), `${mark.text} at ${nowMs} ms in ${at.frame.width}x${at.frame.height}`).toBe(true);
        }
      }
    }
  });

  it("clears the screen once the line has been over for a while", () => {
    expect(marks([line("now", 0, 500)], 5000)).toEqual([]);
  });
});
