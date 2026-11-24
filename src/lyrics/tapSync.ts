import { LAST_LINE_MS, parseLyrics } from "./parse";
import type { RawLyrics } from "./types";

export type SyncUnit = "line" | "word";

export interface SyncWord {
  text: string;
  atMs: number | null;
}

export interface SyncLine {
  text: string;
  atMs: number | null;
  endMs: number | null;
  words: SyncWord[];
}

export interface SyncCursor {
  line: number;
  word: number;
}

export interface SyncStep {
  lines: SyncLine[];
  cursor: SyncCursor;
}

export function detectFormat(text: string): "lrc" | "plain" {
  return /^\s*\[\d+:\d{2}/m.test(text) ? "lrc" : "plain";
}

const UNSPACED = /[\u3040-\u30ff\u3400-\u9fff\u0e00-\u0e7f]/;

export function splitWords(text: string): string[] {
  if (!UNSPACED.test(text)) return text.match(/\S+\s*/g) ?? [];
  const words: string[] = [];
  for (const { segment, isWordLike } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (isWordLike || words.length === 0) words.push(segment);
    else words[words.length - 1] += segment;
  }
  return words;
}

function untimed(text: string): SyncLine {
  return { text, atMs: null, endMs: null, words: splitWords(text).map((word) => ({ text: word, atMs: null })) };
}

export function startSync(text: string): SyncLine[] {
  const timed = detectFormat(text) === "lrc" ? parseLyrics({ format: "lrc", content: text }, 0) : null;
  if (!timed?.synced) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map(untimed);
  }
  const lines: SyncLine[] = [];
  timed.lines.forEach((line, index) => {
    const previous = lines.at(-1);
    if (line.text === "") {
      if (previous) previous.endMs = line.fromMs;
      return;
    }
    const words = line.words?.filter((word) => !word.background);
    const lastEnd = words?.at(-1)?.toMs;
    lines.push({
      text: line.text,
      atMs: line.fromMs,
      endMs: lastEnd !== undefined && lastEnd !== timed.lines[index + 1]?.fromMs ? lastEnd : null,
      words: words ? words.map((word) => ({ text: word.text, atMs: word.fromMs })) : untimed(line.text).words,
    });
  });
  return lines;
}

const whole = (ms: number) => Math.max(0, Math.round(ms));
const replaced = (lines: SyncLine[], index: number, line: SyncLine) => lines.map((other, at) => (at === index ? line : other));
const moved = (ms: number | null, delta: number) => (ms === null ? null : whole(ms + delta));

function shifted(line: SyncLine, delta: number): SyncLine {
  return {
    ...line,
    atMs: moved(line.atMs, delta),
    endMs: moved(line.endMs, delta),
    words: line.words.map((word) => ({ ...word, atMs: moved(word.atMs, delta) })),
  };
}

function withWord(line: SyncLine, index: number, atMs: number | null): SyncLine {
  return {
    ...line,
    ...(index === 0 ? { atMs } : {}),
    words: line.words.map((word, at) => (at === index ? { ...word, atMs } : word)),
  };
}

function forward(lines: SyncLine[], { line, word }: SyncCursor, unit: SyncUnit): SyncCursor {
  return unit === "word" && word + 1 < lines[line].words.length ? { line, word: word + 1 } : { line: line + 1, word: 0 };
}

function back(lines: SyncLine[], { line, word }: SyncCursor, unit: SyncUnit): SyncCursor {
  if (unit === "word" && word > 0) return { line, word: word - 1 };
  if (line === 0) return { line: 0, word: 0 };
  return { line: line - 1, word: unit === "word" ? Math.max(0, lines[line - 1].words.length - 1) : 0 };
}

export function tap(lines: SyncLine[], cursor: SyncCursor, ms: number, unit: SyncUnit): SyncStep {
  const line = lines[cursor.line];
  if (!line) return { lines, cursor };
  const atMs = whole(ms);
  const timed = unit === "word" ? withWord(line, cursor.word, atMs) : line.atMs === null ? { ...line, atMs } : shifted(line, atMs - line.atMs);
  return { lines: replaced(lines, cursor.line, timed), cursor: forward(lines, cursor, unit) };
}

export function endLine(lines: SyncLine[], cursor: SyncCursor, ms: number): SyncLine[] {
  const index = cursor.word > 0 ? cursor.line : cursor.line - 1;
  const line = lines[index];
  const last = line ? (line.words.at(-1)?.atMs ?? line.atMs) : null;
  return line && last !== null && whole(ms) > last ? replaced(lines, index, { ...line, endMs: whole(ms) }) : lines;
}

export function untap(lines: SyncLine[], cursor: SyncCursor, unit: SyncUnit): SyncStep {
  const to = back(lines, cursor, unit);
  const line = lines[to.line];
  if (!line || (to.line === cursor.line && to.word === cursor.word)) return { lines, cursor };
  const cleared = unit === "word" ? { ...withWord(line, to.word, null), endMs: null } : { ...line, atMs: null, endMs: null };
  return { lines: replaced(lines, to.line, cleared), cursor: to };
}

export function nudge(lines: SyncLine[], { line: index, word }: SyncCursor, deltaMs: number, unit: SyncUnit): SyncLine[] {
  const line = lines[index];
  if (!line || line.atMs === null) return lines;
  if (unit === "line") return replaced(lines, index, shifted(line, deltaMs));
  const atMs = line.words[word]?.atMs ?? null;
  return atMs === null ? lines : replaced(lines, index, withWord(line, word, whole(atMs + deltaMs)));
}

const lineTimed = (line: SyncLine) => line.atMs !== null;
const wordsTimed = (line: SyncLine) => line.words.length > 0 && line.words.every((word) => word.atMs !== null);

export function timedCount(lines: SyncLine[], unit: SyncUnit): { done: number; total: number } {
  if (unit === "line") return { done: lines.filter(lineTimed).length, total: lines.length };
  const words = lines.flatMap((line) => line.words);
  return { done: words.filter((word) => word.atMs !== null).length, total: words.length };
}

export function isComplete(lines: SyncLine[]): boolean {
  return lines.length > 0 && lines.every(lineTimed);
}

export function firstOpen(lines: SyncLine[], unit: SyncUnit): SyncCursor {
  const line = lines.findIndex((candidate) => (unit === "line" ? !lineTimed(candidate) : !wordsTimed(candidate)));
  if (line < 0) return { line: lines.length, word: 0 };
  return {
    line,
    word:
      unit === "word"
        ? Math.max(
            0,
            lines[line].words.findIndex((word) => word.atMs === null),
          )
        : 0,
  };
}

export function soundingAt(lines: SyncLine[], ms: number): SyncCursor | null {
  let line = -1;
  lines.forEach((candidate, index) => {
    if (candidate.atMs !== null && candidate.atMs <= ms) line = index;
  });
  if (line < 0 || (lines[line].endMs !== null && lines[line].endMs! <= ms)) return null;
  let word = -1;
  lines[line].words.forEach((candidate, index) => {
    if (candidate.atMs !== null && candidate.atMs <= ms) word = index;
  });
  return { line, word };
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatStamp(ms: number): string {
  const hundredths = Math.floor(ms / 10);
  return `[${pad(Math.floor(hundredths / 6000))}:${pad(Math.floor((hundredths % 6000) / 100))}.${pad(hundredths % 100)}]`;
}

export function toLrc(lines: SyncLine[]): string {
  return lines
    .filter(lineTimed)
    .flatMap((line) => {
      const start = formatStamp(line.atMs!);
      if (wordsTimed(line)) {
        const words = line.words.map((word) => `${wordStamp(word.atMs!)}${word.text}`).join("");
        return [`${start}${words}${line.endMs === null ? "" : wordStamp(line.endMs)}`];
      }
      return line.endMs === null ? [`${start} ${line.text}`] : [`${start} ${line.text}`, formatStamp(line.endMs)];
    })
    .join("\n");
}

const xml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
const clock = (ms: number) => `${formatStamp(ms).slice(1, 6)}.${String(ms % 1000).padStart(3, "0")}`;

export function toTtml(lines: SyncLine[], durationMs: number): string {
  const timed = lines.filter(lineTimed);
  const rows = timed.map((line, index) => {
    const lastStart = line.words.at(-1)?.atMs ?? line.atMs!;
    const end = line.endMs ?? timed[index + 1]?.atMs ?? Math.max(lastStart, Math.min(durationMs, lastStart + LAST_LINE_MS));
    const starts = wordsTimed(line) ? line.words.map((word) => word.atMs!) : [];
    const body = starts.length
      ? line.words
          .map((word, at) => `<span begin="${clock(starts[at])}" end="${clock(Math.max(starts[at], starts[at + 1] ?? end))}">${xml(word.text)}</span>`)
          .join("")
      : xml(line.text);
    return `      <p begin="${clock(line.atMs!)}" end="${clock(end)}">${body}</p>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body dur="${clock(Math.max(0, Math.round(durationMs)))}">
    <div>
${rows.join("\n")}
    </div>
  </body>
</tt>
`;
}

const wordStamp = (ms: number) => `<${formatStamp(ms).slice(1, -1)}>`;

/** Text the editor can hold: word-timed TTML becomes LRC with a stamp before every word. */
export function editableText(lyrics: RawLyrics): string {
  if (lyrics.format !== "ttml") return lyrics.content;
  const parsed = parseLyrics(lyrics, 0);
  if (!parsed?.synced) return parsed?.plainText ?? "";
  return parsed.lines
    .filter((line) => !line.instrumental)
    .map((line) => {
      const words = (line.words ?? []).filter((word) => !word.background);
      if (words.length === 0) return `${formatStamp(line.fromMs)}${line.text}`;
      return `${formatStamp(line.fromMs)}${words.map((word) => `${wordStamp(word.fromMs)}${word.text}`).join("")}${wordStamp(line.toMs)}`;
    })
    .join("\n");
}

const SPEED_TAG = /\b(sped|speed)\s?up\b|\bspedup\b|\bslowed\b|\bnightcore\b|ускорен|замедлен|спид\s?ап/i;

export function stretchedToFit(text: string, title: string, fromMs: number, toMs: number): string {
  const factor = toMs / fromMs;
  if (!SPEED_TAG.test(title) || !Number.isFinite(factor) || factor <= 0 || Math.abs(toMs - fromMs) <= 2000) return text;
  return text.replace(/([[<])(\d+):(\d{2}(?:\.\d+)?)([\]>])/g, (_, open: string, minutes: string, seconds: string, close: string) => {
    const stamp = formatStamp((Number(minutes) * 60 + Number(seconds)) * 1000 * factor).slice(1, -1);
    return `${open}${stamp}${close}`;
  });
}
