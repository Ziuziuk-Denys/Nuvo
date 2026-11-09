import type { HighlightMode } from "./highlightMode";

/** Times in seconds, as @braccato/core keeps them on its rendered lines. */
interface MarkPart {
  time: number;
  duration: number;
  lyricElement: HTMLElement;
}

export interface MarkLine {
  time: number;
  duration: number;
  lyricElement: HTMLElement;
  parts: readonly MarkPart[];
}

interface Mark {
  fromMs: number;
  sungMs: number;
  toMs: number;
  lineToMs: number;
  line: number;
  element: HTMLElement;
}

const LIT = "data-nuvo-now";
const FILLING = "data-nuvo-fill";
const FILL_PROPERTY = "--nuvo-fill";
/** A word stays lit over a gap this short, so a breath inside a phrase does not blink. */
const HOLD_MS = 120;
/** A move further than this is a seek, not the clock going on. */
const JUMP_MS = 250;

// A part as long as the whole line, next to other parts, is the romanized row
function marksOf(source: MarkLine, line: number, words: boolean): Mark[] {
  const mark = (fromMs: number, sungMs: number, element: HTMLElement) => ({ fromMs, sungMs, toMs: sungMs, lineToMs: sungMs, line, element });
  const fromMs = source.time * 1000;
  const whole = [mark(fromMs, fromMs + source.duration * 1000, source.lyricElement)];
  if (!words || !source.parts.some((part) => part.duration > 0)) return whole;
  const sung = source.parts.filter((part) => source.parts.length === 1 || part.duration < source.duration);
  if (sung.length === 0) return whole;
  return sung.map((part) => mark(part.time * 1000, (part.time + Math.max(0, part.duration)) * 1000, part.lyricElement));
}

// shortcut: two voices at once light only the later one; add a mark per voice for duets
export class NowMark {
  private readonly marks: Mark[];
  private readonly keeps: boolean;
  private reached = -1;
  private lastMs = 0;
  private lit = new Set<Mark>();
  private filling: Mark | null = null;
  private fillShown = -1;

  constructor(
    lines: readonly MarkLine[],
    private readonly mode: HighlightMode,
    private readonly reducedMotion: () => boolean,
  ) {
    this.keeps = mode === "fill" || mode === "step";
    this.marks = lines.flatMap((line, index) => marksOf(line, index, mode !== "line")).sort((a, b) => a.fromMs - b.fromMs);
    const lineEnds = new Map<number, number>();
    this.marks.forEach((mark, index) => {
      mark.toMs = Math.min(mark.sungMs + HOLD_MS, this.marks[index + 1]?.fromMs ?? Infinity);
      lineEnds.set(mark.line, Math.max(lineEnds.get(mark.line) ?? 0, mark.toMs));
    });
    for (const mark of this.marks) mark.lineToMs = lineEnds.get(mark.line) ?? mark.toMs;
  }

  update(atMs: number): void {
    const jumped = Math.abs(atMs - this.lastMs) > JUMP_MS;
    this.lastMs = atMs;
    const started = this.lastStarted(atMs);
    // while playing the mark moves one step at a time, so a word shorter than a tick still gets its turn
    const step = jumped ? started : Math.min(Math.max(started, this.reached), this.reached + 1);
    this.reached = step;
    const mark = this.marks[step];
    const behind = step < started;
    const live = mark !== undefined && (behind || atMs < (this.keeps ? mark.lineToMs : mark.toMs));
    const filling = live && !behind && this.mode === "fill" && !this.reducedMotion() && atMs < mark.sungMs ? mark : null;
    const lit = new Set<Mark>();
    if (live) {
      if (this.keeps) for (const earlier of this.marks.slice(0, step)) if (earlier.line === mark.line) lit.add(earlier);
      if (mark !== filling) lit.add(mark);
    }
    this.paint(lit);
    this.paintFill(filling, filling ? (atMs - filling.fromMs) / (filling.sungMs - filling.fromMs) : 0);
  }

  private lastStarted(atMs: number): number {
    let low = 0;
    let high = this.marks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.marks[middle].fromMs <= atMs) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  private paint(lit: Set<Mark>): void {
    for (const mark of this.lit) if (!lit.has(mark)) mark.element.removeAttribute(LIT);
    for (const mark of lit) if (!this.lit.has(mark)) mark.element.setAttribute(LIT, "");
    this.lit = lit;
  }

  private paintFill(mark: Mark | null, progress: number): void {
    if (mark !== this.filling) {
      this.filling?.element.removeAttribute(FILLING);
      this.filling?.element.style.removeProperty(FILL_PROPERTY);
      mark?.element.setAttribute(FILLING, "");
      this.filling = mark;
      this.fillShown = -1;
    }
    const shown = Math.round(progress * 100) / 100;
    if (!mark || shown === this.fillShown) return;
    this.fillShown = shown;
    mark.element.style.setProperty(FILL_PROPERTY, String(shown));
  }
}
