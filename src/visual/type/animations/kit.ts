import type { Line } from "@/lyrics";
import { estimateWords, type TimedWord } from "../layout";

export const PHRASE_HOLD_MS = 1200;
const STRESS_LETTERS = 6;

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Phrase {
  line: Line;
  words: TimedWord[];
  shown: TimedWord[];
  complete: boolean;
  endedMs: number;
}

export function shutterTimes(nowMs: number, shutterMs: number, samples: number): number[] {
  if (shutterMs <= 0 || samples < 2) return [nowMs];
  return Array.from({ length: samples }, (_, i) => nowMs - shutterMs + (shutterMs * i) / (samples - 1));
}

export function phraseAt(lines: Line[], nowMs: number): Phrase | null {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].fromMs <= nowMs; i++) index = i;
  if (index < 0) return null;
  const line = lines[index];
  const endedMs = Math.max(0, nowMs - line.toMs);
  if (endedMs > PHRASE_HOLD_MS) return null;
  const words = estimateWords(line);
  const shown = words.filter((word) => word.fromMs <= nowMs);
  return { line, words, shown, complete: shown.length === words.length, endedMs };
}

export function isStressed(word: string, last: boolean): boolean {
  return last || word.replace(/[^\p{L}]/gu, "").length >= STRESS_LETTERS;
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -10 * t));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
