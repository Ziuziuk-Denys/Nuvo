import type { Line } from "@/lyrics";
import type { LyricStyle, Voice } from "../template/schema";

const PHRASE_HOLD_MS = 1200;
const SYLLABLE_MS = 320;
const SHORT_WORD = 3;
const ASCENT = 0.8;
const CAP_HEIGHT = 0.7;
const MAX_SHRINKS = 40;
const SHRINK = 0.9;

export interface TimedWord {
  text: string;
  fromMs: number;
  toMs: number;
}

export interface ShownWord extends TimedWord {
  age: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Measure = (text: string, size: number, voice: Voice) => number;

export interface Run {
  text: string;
  x: number;
  y: number;
  size: number;
  voice: 0 | 1;
  age: number;
}

function syllables(word: string): number {
  return Math.max(1, word.match(/[aeiouyаеёиоуыэюяіїєàâäéèêëîïôöûüœæáíóúñ]+/giu)?.length ?? 1);
}

export function estimateWords(line: Line): TimedWord[] {
  if (line.words?.length) return line.words.map(({ text, fromMs, toMs }) => ({ text, fromMs, toMs }));
  const parts = line.text.match(/\S+\s*/g) ?? [];
  const weights = parts.map(syllables);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = Math.min(line.toMs - line.fromMs, total * SYLLABLE_MS);
  let at = line.fromMs;
  return parts.map((text, i) => {
    const fromMs = at;
    at = i === parts.length - 1 ? line.toMs : at + (span * weights[i]) / total;
    return { text, fromMs: Math.round(fromMs), toMs: Math.round(at) };
  });
}

function currentLine(lines: Line[], nowMs: number): Line | null {
  let current = -1;
  for (let i = 0; i < lines.length && lines[i].fromMs <= nowMs; i++) current = i;
  if (current < 0 || nowMs > lines[current].toMs + PHRASE_HOLD_MS) return null;
  return lines[current];
}

export function lineWords(lines: Line[], nowMs: number): ShownWord[] {
  const line = currentLine(lines, nowMs);
  if (!line) return [];
  return estimateWords(line).map((word) => ({ ...word, age: nowMs - line.fromMs }));
}

export function visibleWords(lines: Line[], nowMs: number): ShownWord[] {
  const line = currentLine(lines, nowMs);
  if (!line) return [];
  return estimateWords(line)
    .filter((word) => word.fromMs <= nowMs)
    .map((word) => ({ ...word, age: nowMs - word.fromMs }));
}

function voiceFor(text: string, style: LyricStyle): 0 | 1 {
  if (style.voices.length < 2) return 0;
  return text.replace(/[^\p{L}]/gu, "").length <= SHORT_WORD ? 1 : 0;
}

interface Piece {
  text: string;
  voice: 0 | 1;
  age: number;
}

function piecesOf(words: ShownWord[], style: LyricStyle): Piece[] {
  return words.map((word) => {
    const voice = voiceFor(word.text, style);
    const trimmed = word.text.trim();
    return { text: style.voices[voice]!.upper ? trimmed.toUpperCase() : trimmed, voice, age: word.age };
  });
}

function single(piece: Piece, box: Box, measure: Measure, style: LyricStyle): Run {
  const voice = style.voices[piece.voice]!;
  const unit = measure(piece.text, 1, voice);
  const size = Math.min(style.size, box.width / unit, box.height / style.leading);
  const width = measure(piece.text, size, voice);
  return { ...piece, size, x: box.x + (box.width - width) / 2, y: box.y + (box.height + size * CAP_HEIGHT) / 2 };
}

export function layoutWords(words: ShownWord[], box: Box, measure: Measure, style: LyricStyle): Run[] {
  const pieces = piecesOf(words, style);
  if (pieces.length === 0) return [];
  if (style.mode === "single") return [single(pieces.at(-1)!, box, measure, style)];

  let size = style.size;
  let placed = place(pieces, box, measure, style, size);
  for (let shrinks = 0; placed.rows * style.leading * size > box.height && shrinks < MAX_SHRINKS; shrinks++) {
    size *= SHRINK;
    placed = place(pieces, box, measure, style, size);
  }
  return placed.runs;
}

function place(pieces: Piece[], box: Box, measure: Measure, style: LyricStyle, size: number): { runs: Run[]; rows: number } {
  const sized = pieces.map((piece) => {
    const voice = style.voices[piece.voice]!;
    let pieceSize = size;
    let width = measure(piece.text, pieceSize, voice);
    if (width > box.width) {
      pieceSize *= box.width / width;
      width = box.width;
    }
    return { ...piece, size: pieceSize, width, space: measure(" ", size, voice) };
  });

  const rows: (typeof sized)[] = [[]];
  let used = 0;
  for (const piece of sized) {
    const row = rows.at(-1)!;
    const needed = row.length ? used + piece.space + piece.width : piece.width;
    if (row.length && needed > box.width) {
      rows.push([piece]);
      used = piece.width;
    } else {
      row.push(piece);
      used = needed;
    }
  }

  const runs: Run[] = [];
  rows.forEach((row, index) => {
    const open = index === rows.length - 1;
    const content = row.reduce((sum, piece) => sum + piece.width, 0);
    const natural = content + row.slice(1).reduce((sum, piece) => sum + piece.space, 0);
    const justify = style.align === "justify" && !open && row.length > 1;
    const gap = justify ? (box.width - content) / (row.length - 1) : 0;
    let x = box.x + (style.align === "centre" ? (box.width - natural) / 2 : 0);
    const y = box.y + size * ASCENT + index * style.leading * size;
    for (const piece of row) {
      runs.push({ text: piece.text, voice: piece.voice, age: piece.age, size: piece.size, x, y });
      x += piece.width + (justify ? gap : piece.space);
    }
  });
  return { runs, rows: rows.length };
}
