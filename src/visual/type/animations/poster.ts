import type { Line } from "@/lyrics";
import type { Voice } from "../../template/schema";
import { estimateWords, type Box, type Measure, type TimedWord } from "../layout";
import { fontFor } from "../raster";
import { hash, phraseAt } from "./kit";
import { QUIET, type LyricAnimation } from "./types";

const CAPS: Voice = { family: "condensed", weight: 900, italic: false, upper: true };
const SOFT: Voice = { family: "serif", weight: 400, italic: true, upper: false };
const PHRASE_MAX_WORDS = 4;
const PHRASE_END = /[,.;:!?…—–]["'»”)]*\s*$/u;
const SOFT_MIN_WORD_MS = 200;
const PUNCH_MIN_MS = 360;
const BIG = 0.167;
const SMALL = 0.104;
const ITALIC = 0.095;
const ECHO = 0.24;
const GAP_EM = 1.25;
const ROW_EM = 1.4;
// the narrowest cut of our condensed face is still wider than poster capitals
const SQUEEZE = 0.72;
const ECHO_SQUEEZE = 1.25;
const ECHO_SHARE = 0.7;
// the echo is drawn in pure red so the background shader can paint it in its own tone
export const ECHO_INK = "#f00";

export interface Mark {
  text: string;
  voice: Voice;
  size: number;
  x: number;
  y: number;
  width: number;
  squeeze: number;
  stretch: number;
  echo: boolean;
}

interface Frame {
  width: number;
  height: number;
}

const letters = (text: string) => text.replace(/[^\p{L}]/gu, "").length;

export interface PosterPhrase {
  words: TimedWord[];
  soft: boolean;
}

function evenly(words: TimedWord[]): TimedWord[][] {
  const count = Math.ceil(words.length / PHRASE_MAX_WORDS);
  const base = Math.floor(words.length / count);
  const extra = words.length % count;
  let at = 0;
  return Array.from({ length: count }, (_, i) => {
    const size = base + (i < extra ? 1 : 0);
    const chunk = words.slice(at, at + size);
    at += size;
    return chunk;
  });
}

export function posterPhrases(line: Line, lineIndex: number): PosterPhrase[] {
  const groups: TimedWord[][] = [[]];
  for (const word of estimateWords(line)) {
    groups.at(-1)!.push(word);
    if (PHRASE_END.test(word.text)) groups.push([]);
  }
  return groups
    .filter((group) => group.length > 0)
    .flatMap(evenly)
    .map((words, index) => {
      const perWord = (words.at(-1)!.toMs - words[0].fromMs) / words.length;
      return { words, soft: (lineIndex + index) % 2 === 0 && words.length >= 2 && perWord >= SOFT_MIN_WORD_MS };
    });
}

function capsMark(line: Line, index: number, word: TimedWord, nowMs: number, box: Box, frame: Frame, measure: Measure, scale: number): Mark {
  const text = word.text.trim().toUpperCase();
  const seed = hash(line.fromMs * 0.0137 + index * 7.31);
  const length = word.toMs - word.fromMs;
  const switched = length >= PUNCH_MIN_MS && nowMs - word.fromMs >= length / 2;
  const big = seed < 0.5 !== switched;
  const tall = big && letters(text) <= 4 && hash(seed * 53.1 + 3.1) < 0.5;
  const squeeze = tall ? SQUEEZE * 0.6 : SQUEEZE;
  const stretch = tall ? 1.25 : 1;
  const unit = Math.min(frame.width, frame.height);
  const size = Math.min((big ? BIG : SMALL) * unit * scale, (box.width * 100) / (measure(text, 100, CAPS) * squeeze), box.height / stretch);
  return {
    text,
    voice: CAPS,
    size,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width: measure(text, size, CAPS) * squeeze,
    squeeze,
    stretch,
    echo: false,
  };
}

function echoMark(text: string, box: Box, frame: Frame, measure: Measure, scale: number): Mark {
  const y = box.y + box.height / 2;
  const unit = Math.min(frame.width, frame.height);
  const size = Math.min(ECHO * unit * scale, (frame.width * 0.92 * 100) / (measure(text, 100, CAPS) * ECHO_SQUEEZE), 2 * Math.min(y, frame.height - y));
  return { text, voice: CAPS, size, x: frame.width / 2, y, width: measure(text, size, CAPS) * ECHO_SQUEEZE, squeeze: ECHO_SQUEEZE, stretch: 1, echo: true };
}

function softMarks(words: string[], shown: number, complete: boolean, seedMs: number, box: Box, frame: Frame, measure: Measure, scale: number): Mark[] {
  const cols = words.length === 4 ? 2 : words.length;
  const rowsOf = (items: string[]) => Array.from({ length: Math.ceil(items.length / cols) }, (_, row) => items.slice(row * cols, row * cols + cols));
  const em = (word: string) => measure(word, 100, SOFT) / 100;
  const natural = (row: string[]) => row.reduce((sum, word) => sum + em(word), 0) + GAP_EM * (row.length - 1);
  const full = rowsOf(words);
  const unit = Math.min(frame.width, frame.height);
  const size = Math.min(ITALIC * unit * scale, box.width / Math.max(...full.map(natural)), box.height / ((full.length - 1) * ROW_EM + 1));
  const rows = rowsOf(words.slice(0, shown));
  const block = Math.max(...rows.map(natural)) * size;
  const left = box.x + (box.width - block) / 2;
  const top = box.y + box.height / 2 - ((rows.length - 1) * ROW_EM * size) / 2;
  const marks = rows.flatMap((row, r) => {
    const justified = rows.length > 1 && row.length === cols;
    const gap = justified ? (block - row.reduce((sum, word) => sum + em(word) * size, 0)) / (row.length - 1) : GAP_EM * size;
    let x = left;
    return row.map((text) => {
      const width = measure(text, size, SOFT);
      const mark: Mark = { text, voice: SOFT, size, x: x + width / 2, y: top + r * ROW_EM * size, width, squeeze: 1, stretch: 1, echo: false };
      x += width + gap;
      return mark;
    });
  });
  const longest = words.reduce((best, word) => (letters(word) >= letters(best) ? word : best), "");
  if (!complete || letters(longest) < 4 || hash(seedMs * 0.013 + 1.7) >= ECHO_SHARE) return marks;
  return [echoMark(longest.toUpperCase(), box, frame, measure, scale), ...marks];
}

export function posterMarks(lines: Line[], nowMs: number, box: Box, frame: Frame, measure: Measure, scale = 1): Mark[] {
  const phrase = phraseAt(lines, nowMs);
  if (!phrase || phrase.shown.length === 0) return [];
  const index = phrase.shown.length - 1;
  let start = 0;
  for (const part of posterPhrases(phrase.line, lines.indexOf(phrase.line))) {
    if (index >= start + part.words.length) {
      start += part.words.length;
      continue;
    }
    if (!part.soft) return [capsMark(phrase.line, index, phrase.shown[index], nowMs, box, frame, measure, scale)];
    const shown = index - start + 1;
    const texts = part.words.map((word) => word.text.trim());
    return softMarks(texts, shown, shown === texts.length, part.words[0].fromMs, box, frame, measure, scale);
  }
  return [];
}

export const poster: LyricAnimation = {
  id: "poster",
  leadMs: 50,
  weight: 1,
  zone: "centre",
  draw({ ctx, lines, nowMs, width, height, box, scale = 1 }) {
    const measure: Measure = (text, size, voice) => {
      ctx.font = fontFor(voice, size);
      return ctx.measureText(text).width;
    };
    ctx.textAlign = "center";
    for (const mark of posterMarks(lines, nowMs, box, { width, height }, measure, scale)) {
      ctx.font = fontFor(mark.voice, mark.size);
      ctx.fillStyle = mark.echo ? ECHO_INK : "#fff";
      ctx.save();
      ctx.translate(mark.x, mark.y);
      ctx.scale(mark.squeeze, mark.stretch);
      ctx.fillText(mark.text, 0, mark.size * (mark.voice.italic ? 0.25 : 0.345));
      ctx.restore();
    }
    return QUIET;
  },
};
