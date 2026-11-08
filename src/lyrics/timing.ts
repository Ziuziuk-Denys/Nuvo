/** Offsets and the active line. */
import type { Line, Word } from "./types";

export const OFFSET_LIMIT_MS = 30_000;
/** A line becomes active this long before its start, never before the previous line ends. */
export const LEAD_MS = 600;

/** The one lyrics loop: 30 updates a second. Each visible change costs a whole compositor frame, a timer costs none when nothing changes. */
export const FRAME_MS = 1000 / 30;

export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  const rounded = Math.round(ms);
  if (rounded === 0) return 0;
  return Math.min(OFFSET_LIMIT_MS, Math.max(-OFFSET_LIMIT_MS, rounded));
}

/** Positive offsets make lyrics later. The input is never changed, so offsets stay lossless. */
export function shiftLines(lines: Line[], offsetMs: number): Line[] {
  if (offsetMs === 0) return lines;
  const move = (ms: number) => Math.max(0, ms + offsetMs);
  const moveWords = (words: Word[]) => words.map((word) => ({ ...word, fromMs: move(word.fromMs), toMs: move(word.toMs) }));
  return lines.map((line) => ({
    ...line,
    fromMs: move(line.fromMs),
    toMs: move(line.toMs),
    ...(line.words ? { words: moveWords(line.words) } : {}),
  }));
}

/** Lead start per line, made non-decreasing so the active line is a binary search. */
export function leadStarts(lines: Line[]): number[] {
  const leads: number[] = [];
  let floor = 0;
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    // a line without word timing never delays the next line's lead
    const previousEnd = previous ? (previous.words?.at(-1)?.toMs ?? previous.fromMs) : 0;
    const lead = Math.max(previousEnd, line.fromMs - LEAD_MS, floor);
    leads.push(lead);
    floor = lead;
  });
  return leads;
}

/** The last non-companion line whose lead start is at or before the position; null before the first. */
export function activeLine(lines: Line[], leads: number[], positionMs: number): number | null {
  let low = 0;
  let high = leads.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (leads[middle] <= positionMs) low = middle + 1;
    else high = middle;
  }
  for (let index = low - 1; index >= 0; index -= 1) {
    if (!lines[index].companion) return index;
  }
  return null;
}
