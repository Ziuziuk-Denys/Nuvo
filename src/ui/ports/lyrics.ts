/** Lyrics data, commands and timing helpers for the karaoke view, the Notch feed and the island. */
import { useSyncExternalStore } from "react";
import { FRAME_MS, lyrics, pinTopOnNewTrack, releaseTopPin, romanizeKana, romanizerFor, wordProgress, type LyricsState, type Version } from "@/lyrics";
import type { TFunction } from "./i18n";

export { FRAME_MS, romanizeKana, romanizerFor };
export type { Line, LyricsState, LyricsStatus, RawLyrics, Version, Word, PinInput, ReleaseInput } from "@/lyrics";

const subscribe = (listener: () => void) => lyrics().subscribe(listener);

/** One field of the lyrics state; the component re-renders only when the selected value changes. */
export function useLyrics<T>(selector: (state: LyricsState) => T): T {
  const read = () => selector(lyrics().getState());
  return useSyncExternalStore(subscribe, read, read);
}

/** The daemon's word when it sends one, the user's own lyrics by name, else a word for the version's sync depth. */
export function versionLabel(version: Version, t: TFunction): string {
  if (version.label) return version.label;
  if (version.topPriority) return t("ui.lyrics.version_own");
  if (version.syncLevel === "word_level" || version.syncLevel === "syllable_level") return t("ui.lyrics.version_word");
  if (version.syncLevel === "line_level") return t("ui.lyrics.version_synced");
  return t("ui.lyrics.version_plain");
}

export function lyricsErrorText(state: Pick<LyricsState, "status">, t: TFunction): string | null {
  return state.status === "error" ? t("ui.lyrics.load_failed") : null;
}

export const lyricsCommands = {
  /** The karaoke view asks for the current track's lyrics: a restored session only looks them up once it plays. */
  follow: (track: Parameters<ReturnType<typeof lyrics>["follow"]>[0]) => void lyrics().follow(track),
  chooseVersion: (provider: string) => lyrics().chooseVersion(provider),
  changeOffset: (ms: number) => lyrics().changeOffset(ms),
  /** The view's "Earlier" and "Later" controls send -100 and +100. */
  nudgeOffset: (deltaMs: number) => lyrics().nudgeOffset(deltaMs),
  clearOffset: () => lyrics().clearOffset(),
  clock: () => lyrics().clock(),
  /** A view's per-frame work, on the engine's one loop. */
  onFrame: (listener: () => void) => lyrics().onFrame(listener),
  wordProgress,
  pinTopOnNewTrack,
  releaseTopPin,
};
