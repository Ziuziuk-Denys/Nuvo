import { fontFor } from "../raster";
import { easeOutCubic, phraseAt } from "./kit";
import { QUIET, type LyricAnimation } from "./types";

const MARGIN = 0.125;
const OPEN_SPACING_EM = 0.5;

export interface PaperWord {
  text: string;
  x: number;
}

export interface PaperRow {
  words: PaperWord[];
}

function groupsOf(texts: string[], measure: (text: string) => number, available: number, space: number, perRow: number): string[][] {
  const groups: string[][] = [];
  let row: string[] = [];
  let used = 0;
  for (const text of texts) {
    const needed = row.length ? used + space + measure(text) : measure(text);
    if (row.length && (row.length >= perRow || needed > available)) {
      groups.push(row);
      row = [text];
      used = measure(text);
    } else {
      row.push(text);
      used = needed;
    }
  }
  if (row.length) groups.push(row);
  return groups;
}

export function paperRows(texts: string[], width: number, measure: (text: string) => number, size = 72, perRow = 3): PaperRow[] {
  const left = width * MARGIN;
  const right = width * (1 - MARGIN);
  const space = size * OPEN_SPACING_EM;
  const groups = groupsOf(texts, measure, right - left, space, perRow);

  const open = (group: string[], start: number): PaperRow => {
    let x = start;
    return {
      words: group.map((text) => {
        const word = { text, x };
        x += measure(text) + space;
        return word;
      }),
    };
  };

  return groups.map((group, index) => {
    if (index === groups.length - 1 || group.length < 2) return open(group, left);
    const content = group.reduce((sum, text) => sum + measure(text), 0);
    const gap = (right - left - content) / (group.length - 1);
    let x = left;
    return {
      words: group.map((text) => {
        const word = { text, x };
        x += measure(text) + gap;
        return word;
      }),
    };
  });
}

const SHRINK = 0.92;
const MIN_SHARE = 0.3;
const HEIGHT_SHARE = 0.6;

export function paperSize(texts: string[], width: number, height: number, measureAt: (text: string, size: number) => number, base: number): number {
  const available = width * (1 - 2 * MARGIN);
  let size = base;
  for (; size > base * MIN_SHARE; size *= SHRINK) {
    const measure = (text: string) => measureAt(text, size);
    if (Math.max(0, ...texts.map(measure)) > available) continue;
    if (groupsOf(texts, measure, available, size * OPEN_SPACING_EM, 3).length * size * LEADING <= height * HEIGHT_SHARE) break;
  }
  return size;
}

const NEUTRAL = { family: "neutral" as const, weight: 400, italic: false, upper: false };
const ASCENT = 0.72;
const LEADING = 1.19;
const APPEAR_MS = 70;

export const paper: LyricAnimation = {
  id: "paper",
  leadMs: 50,
  weight: 2,
  zone: "full",
  draw({ ctx, lines, nowMs, width, height }) {
    const phrase = phraseAt(lines, nowMs);
    if (!phrase || phrase.shown.length === 0) return QUIET;
    const texts = phrase.words.map((word) => word.text.trim());
    const measureAt = (text: string, px: number) => {
      ctx.font = fontFor(NEUTRAL, px);
      return ctx.measureText(text).width;
    };
    const size = paperSize(texts, width, height, measureAt, 0.125 * Math.min(width, height));
    ctx.font = fontFor(NEUTRAL, size);
    const measure = (text: string) => ctx.measureText(text).width;
    const rows = paperRows(texts, width, measure, size);
    const top = height * (height > width * 1.2 ? 0.3 : 0.252);
    ctx.fillStyle = "#fff";
    let index = 0;
    rows.forEach((row, rowIndex) => {
      const baseline = top + size * ASCENT + rowIndex * size * LEADING;
      for (const word of row.words) {
        if (index >= phrase.shown.length) break;
        const appear = easeOutCubic((nowMs - phrase.shown[index].fromMs) / APPEAR_MS);
        ctx.globalAlpha = appear;
        ctx.fillText(word.text, word.x, baseline + (1 - appear) * size * 0.06);
        index++;
      }
    });
    ctx.globalAlpha = 1;
    return QUIET;
  },
};
