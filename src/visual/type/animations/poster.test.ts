import { describe, expect, it } from "vitest";
import type { Line } from "@/lyrics";
import type { Box } from "../layout";
import { posterMarks, posterMode, type Mark } from "./poster";

const measure = (text: string, size: number) => text.length * size * 0.5;

function line(text: string, fromMs: number, toMs: number): Line {
  return { text, fromMs, toMs, companion: false, instrumental: false };
}

function frameOf(width: number, height: number): { frame: { width: number; height: number }; box: Box } {
  return { frame: { width, height }, box: { x: width * 0.08, y: height * 0.38, width: width * 0.84, height: height * 0.24 } };
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

describe("poster mode", () => {
  it("sets short slow lines in soft italics and busy lines in caps", () => {
    expect(posterMode(line("your problem", 0, 1600))).toBe("soft");
    expect(posterMode(line("how can you be", 0, 2400))).toBe("soft");
    expect(posterMode(line("try to eat sorrow what's", 0, 2500))).toBe("caps");
    expect(posterMode(line("so unlikable", 0, 500))).toBe("caps");
    expect(posterMode(line("soul", 0, 2000))).toBe("caps");
  });
});

describe("caps", () => {
  const lines = [line("try to eat sorrow", 1000, 2600)];

  it("shows only the word being sung, in capitals", () => {
    expect(texts(marks(lines, 1050))).toEqual(["TRY"]);
    expect(texts(marks(lines, 2590))).toEqual(["SORROW"]);
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
    const quick = [{ ...line("to eat", 1000, 1600), words }];
    expect(marks(quick, 1190)[0].size).toBeCloseTo(marks(quick, 1010)[0].size);
  });

  it("stretches short words tall and leaves long words as they are", () => {
    const short = Array.from({ length: 12 }, (_, i) => marks([line("off", i * 1000, i * 1000 + 900)], i * 1000 + 10)[0]);
    expect(short.some((mark) => mark.stretch > 1)).toBe(true);
    const long = marks([line("unlikable", 0, 900)], 10)[0];
    expect(long.stretch).toBe(1);
  });
});

describe("soft", () => {
  it("adds words one by one on a centred row with even gaps", () => {
    const lines = [line("for just this", 0, 1800)];
    expect(texts(marks(lines, 10))).toEqual(["for"]);
    const row = marks(lines, 1790).filter((mark) => !mark.echo);
    expect(row.map((mark) => mark.text)).toEqual(["for", "just", "this"]);
    expect(new Set(row.map((mark) => mark.y)).size).toBe(1);
    expect((row[0].x + row[2].x) / 2).toBeCloseTo(tall.box.x + tall.box.width / 2);
    expect(row[1].x - row[0].x).toBeCloseTo(row[2].x - row[1].x);
  });

  it("wraps a four-word line into two rows of two", () => {
    const grid = marks([line("how can you be", 0, 2400)], 2390).filter((mark) => !mark.echo);
    expect(grid.map((mark) => mark.text)).toEqual(["how", "can", "you", "be"]);
    expect(grid[2].x).toBeCloseTo(grid[0].x);
    expect(grid[3].x).toBeCloseTo(grid[1].x);
    expect(grid[2].y).toBeGreaterThan(grid[0].y);
  });

  it("puts a big echo of the longest word behind some complete lines and none before the line is complete", () => {
    const echoes = Array.from({ length: 16 }, (_, i) => {
      const lines = [line("sleep alone", i * 3000, i * 3000 + 1600)];
      expect(marks(lines, i * 3000 + 10).some((mark) => mark.echo)).toBe(false);
      return marks(lines, i * 3000 + 1590);
    });
    const withEcho = echoes.filter((found) => found[0].echo);
    expect(withEcho.length).toBeGreaterThan(0);
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
  ];

  it("keeps every word inside the lyric box and every echo inside the frame, at any size and aspect", () => {
    for (const at of frames) {
      for (let nowMs = 0; nowMs < 10_000; nowMs += 50) {
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
