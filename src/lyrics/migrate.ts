/** One-time move of renderer-side lyrics data to the daemon. */
import { clampOffset } from "./timing";

export const LEGACY_SESSION_KEY = "nuvo_lyrics_session_v1";
/** The daemon refuses an import of more than 10,000 offsets. */
export const OFFSETS_PER_IMPORT = 10_000;
/** Cached copies only, no user data. */
const LEGACY_CACHE_KEY = /^nuvo_lyrics_(v2_index|v2_item_.*|lru_index|item_.*)$/;

/** The non-zero numeric offsets of a legacy session, clamped; anything unreadable gives an empty map. */
export function legacyOffsets(raw: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const map = (parsed as { state?: { trackOffsets?: unknown } } | null)?.state?.trackOffsets;
  if (typeof map !== "object" || map === null) return {};
  const offsets: Record<string, number> = {};
  for (const [trackId, value] of Object.entries(map)) {
    if (typeof value !== "number") continue;
    const offsetMs = clampOffset(value);
    if (offsetMs !== 0) offsets[trackId] = offsetMs;
  }
  return offsets;
}

/** True when nothing legacy is left; false when the daemon refused, so the next start tries again. */
export async function migrateLegacyLyrics(storage: Storage, sendOffsets: (offsets: Record<string, number>) => Promise<void>): Promise<boolean> {
  const raw = storage.getItem(LEGACY_SESSION_KEY);
  if (raw !== null) {
    const entries = Object.entries(legacyOffsets(raw));
    try {
      // a batch sent before a refusal is sent again next start; the daemon's import overwrites
      for (let start = 0; start < entries.length; start += OFFSETS_PER_IMPORT) {
        await sendOffsets(Object.fromEntries(entries.slice(start, start + OFFSETS_PER_IMPORT)));
      }
    } catch {
      return false;
    }
    storage.removeItem(LEGACY_SESSION_KEY);
  }
  const stale: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && LEGACY_CACHE_KEY.test(key)) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
  return true;
}
