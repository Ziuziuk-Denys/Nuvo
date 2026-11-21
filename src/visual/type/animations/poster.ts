import type { Line } from "@/lyrics";
import type { Voice } from "../../template/schema";
import { estimateWords, type Box, type Measure, type TimedWord } from "../layout";
import { fontFor } from "../raster";
import { hash, phraseAt } from "./kit";
import { QUIET, type LyricAnimation } from "./types";

const CAPS: Voice = { family: "condensed", weight: 800, italic: false, upper: true };
const SOFT: Voice = { family: "serif", weight: 400, italic: true, upper: false };
const SOFT_MAX_WORDS = 4;
const SOFT_MIN_WORD_MS = 450;
const PUNCH_MIN_MS = 360;
const STRETCH = 1.35;
// the echo is drawn in pure red so the background shader can paint it in its own tone
export const ECHO_INK = "#f00";

export interface Mark {
  text: string;
  voice: Voice;
  size: number;
  x: number;
  y: number;
  width: number;
  stretch: number;
  echo: boolean;
}

interface Frame {
  width: number;
  height: number;
}

const letters = (text: string) => text.replace(/[^\p{L}]/gu, "").length;

export function posterMode(line: Line): "caps" | "soft" {
  const count = estimateWords(line).length;
  return count >= 2 && count <= SOFT_MAX_WORDS && (line.toMs - line.fromMs) / count >= SOFT_MIN_WORD_MS ? "soft" : "caps";
}

function capsMark(line: Line, index: number, word: TimedWord, nowMs: number, box: Box, frame: Frame, measure: Measure): Mark {
  const text = word.text.trim().toUpperCase();
  const seed = hash(line.fromMs * 0.0137 + index * 7.31);
  const length = word.toMs - word.fromMs;
  const switched = length >= PUNCH_MIN_MS && nowMs - word.fromMs >= length / 2;
  const big = seed < 0.5 !== switched;
  const stretch = big && letters(text) <= 4 && hash(seed * 53.1 + 3.1) < 0.5 ? STRETCH : 1;
  const unit = Math.min(frame.width, frame.height);
  const size = Math.min((big ? 0.16 : 0.075) * unit, (box.width * 100) / measure(text, 100, CAPS), box.height / stretch);
  return { text, voice: CAPS, size, x: box.x + box.width / 2, y: box.y + box.height / 2, width: measure(text, size, CAPS), stretch, echo: false };
}

function softMarks(line: Line, shown: number, complete: boolean, box: Box, frame: Frame, measure: Measure): Mark[] {
  const words = estimateWords(line).map((word) => word.text.trim());
  const cols = words.length === 4 ? 2 : words.length;
  const rows = Math.ceil(words.length / cols);
  const unit = Math.min(frame.width, frame.height);
  const widest = Math.max(...words.map((word) => measure(word, 100, SOFT))) / 100;
  const size = Math.min(0.07 * unit, box.width / ((cols - 1) * (widest + 1.3) + widest), box.height / ((rows - 1) * 1.4 + 1));
  const pitch = (widest + 1.3) * size;
  const shownCols = Math.min(shown, cols);
  const shownRows = Math.ceil(shown / cols);
  const left = box.x + box.width / 2 - ((shownCols - 1) * pitch) / 2;
  const top = box.y + box.height / 2 - ((shownRows - 1) * 1.4 * size) / 2;
  const marks = words.slice(0, shown).map((text, i) => ({
    text,
    voice: SOFT,
    size,
    x: left + (i % cols) * pitch,
    y: top + Math.floor(i / cols) * 1.4 * size,
    width: measure(text, size, SOFT),
    stretch: 1,
    echo: false,
  }));
  const longest = words.reduce((best, word) => (letters(word) >= letters(best) ? word : best), "");
  if (!complete || letters(longest) < 4 || hash(line.fromMs * 0.013) >= 0.5) return marks;
  const text = longest.toUpperCase();
  const y = box.y + box.height / 2;
  const echoSize = Math.min(0.34 * unit, (frame.width * 0.92 * 100) / measure(text, 100, CAPS), 2 * Math.min(y, frame.height - y));
  return [{ text, voice: CAPS, size: echoSize, x: frame.width / 2, y, width: measure(text, echoSize, CAPS), stretch: 1, echo: true }, ...marks];
}

export function posterMarks(lines: Line[], nowMs: number, box: Box, frame: Frame, measure: Measure): Mark[] {
  const phrase = phraseAt(lines, nowMs);
  if (!phrase || phrase.shown.length === 0) return [];
  if (posterMode(phrase.line) === "soft") return softMarks(phrase.line, phrase.shown.length, phrase.complete, box, frame, measure);
  const index = phrase.shown.length - 1;
  return [capsMark(phrase.line, index, phrase.shown[index], nowMs, box, frame, measure)];
}

export const poster: LyricAnimation = {
  id: "poster",
  leadMs: 50,
  weight: 2,
  zone: "centre",
  draw({ ctx, lines, nowMs, width, height, box }) {
    const measure: Measure = (text, size, voice) => {
      ctx.font = fontFor(voice, size);
      return ctx.measureText(text).width;
    };
    ctx.textAlign = "center";
    for (const mark of posterMarks(lines, nowMs, box, { width, height }, measure)) {
      ctx.font = fontFor(mark.voice, mark.size);
      ctx.fillStyle = mark.echo ? ECHO_INK : "#fff";
      ctx.save();
      ctx.translate(mark.x, mark.y);
      ctx.scale(1, mark.stretch);
      ctx.fillText(mark.text, 0, mark.size * (mark.voice.italic ? 0.25 : 0.36));
      ctx.restore();
    }
    return QUIET;
  },
};
