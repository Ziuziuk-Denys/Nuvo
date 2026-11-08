/** The lyrics editor's port: the daemon's user lyrics, the playing position and a reload of what views show. */
import { playerRuntime, usePlayerStore } from "@/engine/compat";
import type { Track } from "@/engine/types";
import { lyrics } from "@/lyrics";
import { deleteUserLyrics, editableLyrics, ensureTranslator, putUserLyrics, translateLines } from "@/lyrics/stream";
import { targetLanguage, textLines } from "@/lyrics/translation";

export { clearStamp, detectFormat, formatStamp, isComplete, markEnd, nudge, stamp, startSync, toLrc, type SyncLine } from "@/lyrics/tapSync";

export { NoTranslatorError } from "@/lyrics/stream";

export type LyricsTrack = Pick<Track, "id" | "title" | "artists" | "coverUrl" | "durationMs">;

/** The fields the lyrics routes read; artist ids of the UI's track shape do not matter here. */
export function toLyricsTrack(track: LyricsTrack): LyricsTrack {
  return { id: track.id, title: track.title, artists: track.artists, coverUrl: track.coverUrl, durationMs: track.durationMs };
}

const fetcher = (input: string, init?: RequestInit) => fetch(input, init);

/** What the views show for the track is read again; before the engine starts there is nothing to refresh. */
async function reloadShown(track: LyricsTrack): Promise<void> {
  let engine: ReturnType<typeof lyrics>;
  try {
    engine = lyrics();
  } catch {
    return;
  }
  await engine.reload(track);
}

export function loadEditable(track: LyricsTrack, signal: AbortSignal) {
  return editableLyrics(fetcher, track, signal);
}

export async function saveLyrics(track: LyricsTrack, lyrics: { format: "lrc" | "plain"; content: string }): Promise<void> {
  await putUserLyrics(fetcher, track.id, lyrics);
  await reloadShown(track);
}

export async function dropUserLyrics(track: LyricsTrack): Promise<void> {
  await deleteUserLyrics(fetcher, track.id);
  await reloadShown(track);
}

export function isPlayingTrack(trackId: string): boolean {
  return usePlayerStore.getState().currentTrack?.id === trackId;
}

export function playbackPositionMs(): number {
  return playerRuntime.getCurrentTimeMs();
}

// shortcut: LM Studio's default address only; add a Settings field when another local server is wanted
export const TRANSLATOR = { endpoint: "http://127.0.0.1:1234", model: "local-model" };

export async function translateTrack(track: LyricsTrack, signal: AbortSignal): Promise<{ original: string[]; translated: string[] }> {
  const raw = await editableLyrics(fetcher, track, signal);
  const original = raw ? textLines(raw) : [];
  if (original.length === 0) return { original, translated: [] };
  await ensureTranslator(fetcher, TRANSLATOR);
  const translated = await translateLines(fetcher, { lang: targetLanguage(original), lines: original }, signal);
  return { original, translated };
}
