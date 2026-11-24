import { playerEngine, playerRuntime, usePlayerStore } from "@/engine/compat";
import type { Track } from "@/engine/types";
import { lyrics } from "@/lyrics";
import { deleteUserLyrics, editableLyrics, ensureTranslator, findLyrics, putUserLyrics, translateLines, type FoundLyrics } from "@/lyrics/stream";
import { targetLanguage, textLines } from "@/lyrics/translation";

export {
  detectFormat,
  editableText,
  endLine,
  firstOpen,
  formatStamp,
  isComplete,
  nudge,
  soundingAt,
  startSync,
  stretchedToFit,
  tap,
  timedCount,
  toLrc,
  toTtml,
  untap,
  type SyncCursor,
  type SyncLine,
  type SyncUnit,
} from "@/lyrics/tapSync";
export type { Candidate as FoundVersion } from "@/lyrics/types";
export { formatDuration } from "@/imports/report";

export { NoTranslatorError } from "@/lyrics/stream";

export type LyricsTrack = Pick<Track, "id" | "title" | "artists" | "coverUrl" | "durationMs">;

export function toLyricsTrack(track: LyricsTrack): LyricsTrack {
  return { id: track.id, title: track.title, artists: track.artists, coverUrl: track.coverUrl, durationMs: track.durationMs };
}

const fetcher = (input: string, init?: RequestInit) => fetch(input, init);

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

export function searchLyrics(query: { title: string; artist: string; durationMs: number }, signal: AbortSignal): Promise<FoundLyrics> {
  return findLyrics(fetcher, query, signal);
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

export const seekPlayback = (ms: number): void => playerEngine.seek(Math.max(0, ms));
export const togglePlayback = (): void => void playerEngine.togglePlayPause();
export const setPlaybackSpeed = (rate: number): void => playerEngine.setPlaybackRate(rate);
export const useIsCurrentTrack = (trackId: string): boolean => usePlayerStore((state) => state.currentTrack?.id === trackId);
export const useIsPlaying = (): boolean => usePlayerStore((state) => state.status === "playing");
export const usePlaybackSpeed = (): number => usePlayerStore((state) => state.playbackRate);

export function saveTimedFile(track: LyricsTrack, format: "lrc" | "ttml", text: string): Promise<boolean> {
  const name =
    `${track.artists} - ${track.title}`
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/^\.+/, "")
      .slice(0, 100)
      .trim() || "lyrics";
  return window.nuvoShell?.saveTextFile(`${name}.${format}`, text) ?? Promise.resolve(false);
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
