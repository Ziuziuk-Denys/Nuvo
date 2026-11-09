import { parseLyrics, type Parsed } from "./parse";
import type { Candidate, StreamEvent, Version } from "./types";

export const MAX_CONTENT_BYTES = 256 * 1024;

const SYNC_DEPTH: Record<string, number> = { syllable_level: 2, word_level: 2, line_level: 1 };

export interface Entry {
  candidate: Candidate;
  parsed: Parsed;
  order: number;
}

function quality(candidate: Candidate): number {
  const total = candidate.quality?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

export function toEntry(event: StreamEvent, order: number, trackMs: number): Entry | null {
  if (event.type !== "provider" || event.status !== "found" || !event.candidate) return null;
  const lyrics = event.candidate.lyrics;
  if (typeof lyrics?.content !== "string" || typeof lyrics.format !== "string") return null;
  if (new TextEncoder().encode(lyrics.content).byteLength > MAX_CONTENT_BYTES) return null;
  const parsed = parseLyrics(lyrics, trackMs);
  return parsed ? { candidate: event.candidate, parsed, order } : null;
}

export function compareEntries(a: Entry, b: Entry): number {
  return (
    Number(b.candidate.topPriority === true) - Number(a.candidate.topPriority === true) ||
    Number(b.parsed.wordTimed) - Number(a.parsed.wordTimed) ||
    quality(b.candidate) - quality(a.candidate) ||
    (SYNC_DEPTH[b.candidate.syncLevel] ?? 0) - (SYNC_DEPTH[a.candidate.syncLevel] ?? 0) ||
    a.order - b.order
  );
}

export function addEntry(entries: Entry[], entry: Entry): Entry[] {
  return [...entries.filter((existing) => existing.candidate.provider !== entry.candidate.provider), entry].sort(compareEntries);
}

export function toVersion(entry: Entry): Version {
  const { candidate, parsed } = entry;
  return {
    provider: candidate.provider,
    label: candidate.label ?? null,
    syncLevel: candidate.syncLevel,
    quality: quality(candidate),
    topPriority: candidate.topPriority === true,
  };
}
