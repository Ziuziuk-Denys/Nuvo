import { parseLRC, parseQRC, parseTTMLContent, type Lyric, type LyricPart } from "@braccato/parsers";
import type { Line, RawLyrics, Word } from "./types";

export const LAST_LINE_MS = 5000;

export const MAX_LINES = 5000;
export const MAX_LINE_CHARS = 2000;

const COMPANION_TAG = /^\s*<[a-z]+>\s*/i;
const MUSIC_ONLY = /^[\s♪♫♬♩]*$/;
/** Rows beside the sung text: the parser would read them as words at time 0. */
const TTML_SIDE_ROW = /<span\b[^>]*\bttm:role="x-(?:translation|roman)"[^>]*?(?:\/>|>[^<]*<\/span>)/g;

export interface Parsed {
  lines: Line[];
  plainText: string;
  synced: boolean;
  wordTimed: boolean;
}

export function parseLyrics(raw: RawLyrics, trackMs: number): Parsed | null {
  const text = raw.content.trim();
  if (text === "") return null;
  if (raw.format === "plain") return plain(text);
  if (raw.format !== "lrc" && raw.format !== "ttml" && raw.format !== "qrc") return null;
  let parsed: Lyric[];
  try {
    parsed = parseTimed(raw.format, text);
  } catch {
    return plain(text);
  }
  const lines = toLines(parsed, raw.format === "lrc", trackMs);
  if (lines.length === 0) return raw.format === "lrc" ? plain(text) : null;
  const plainText = lines
    .filter((line) => !line.instrumental)
    .map((line) => line.text)
    .join("\n");
  if (lines.every((line) => line.fromMs === 0)) return { lines: [], plainText, synced: false, wordTimed: false };
  return { lines, plainText, synced: true, wordTimed: lines.some((line) => line.words !== undefined) };
}

function parseTimed(format: string, text: string): Lyric[] {
  if (format === "ttml") return parseTTMLContent(text.replace(TTML_SIDE_ROW, "")).lyrics;
  if (format === "qrc") return parseQRC(text, 0);
  // song length 0: otherwise the parser stretches the last line to the song end
  return parseLRC(text, 0);
}

function plain(text: string): Parsed {
  return { lines: [], plainText: text, synced: false, wordTimed: false };
}

function lastLineEnd(fromMs: number, trackMs: number): number {
  const end = fromMs + LAST_LINE_MS;
  return trackMs > fromMs ? Math.min(end, trackMs) : end;
}

/** LRC line ends are recomputed: the parser derives them from file order, which sorting breaks. */
function toLines(parsed: Lyric[], recompute: boolean, trackMs: number): Line[] {
  const sorted = parsed
    .filter((lyric) => Number.isFinite(lyric.startTimeMs))
    .map((lyric) => ({ lyric, fromMs: Math.max(0, Math.round(lyric.startTimeMs)) }))
    .sort((a, b) => a.fromMs - b.fromMs)
    .slice(0, MAX_LINES);
  return sorted.map(({ lyric, fromMs }, index) => {
    const next = sorted[index + 1];
    const stated = !recompute && Number.isFinite(lyric.durationMs) && lyric.durationMs > 0;
    const toMs = stated ? fromMs + Math.round(lyric.durationMs) : next ? next.fromMs : lastLineEnd(fromMs, trackMs);
    const companion = COMPANION_TAG.test(lyric.words);
    const text = lyric.words.replace(COMPANION_TAG, "").trim().slice(0, MAX_LINE_CHARS);
    const words = toWords(lyric.parts ?? [], fromMs, toMs, text);
    return {
      fromMs,
      toMs,
      text,
      ...(words ? { words } : {}),
      companion,
      instrumental: lyric.isInstrumental === true || MUSIC_ONLY.test(text),
    };
  });
}

function toWords(parts: LyricPart[], lineStart: number, lineEnd: number, text: string): Word[] | undefined {
  const kept = parts.filter((part) => part.words !== "" && Number.isFinite(part.startTimeMs));
  if (kept.length === 0) return undefined;
  const starts = kept.map((part) => Math.max(0, Math.round(part.startTimeMs)));
  const words = kept.map((part, index) => {
    const fromMs = starts[index];
    const end = Number.isFinite(part.durationMs) && part.durationMs > 0 ? fromMs + Math.round(part.durationMs) : (starts[index + 1] ?? lineEnd);
    return { fromMs, toMs: Math.max(fromMs, Math.min(end, lineEnd)), text: part.words, background: part.isBackground === true };
  });
  const timedText = kept
    .map((part) => part.words)
    .join("")
    .trim();
  const untimed = text.endsWith(timedText) ? text.slice(0, text.length - timedText.length) : "";
  return untimed === "" ? words : [{ fromMs: lineStart, toMs: Math.max(lineStart, starts[0]), text: untimed, background: false }, ...words];
}
