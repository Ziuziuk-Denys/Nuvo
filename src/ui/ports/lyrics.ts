import { useSyncExternalStore } from "react";
import { FRAME_MS, lyrics, pinTopOnNewTrack, releaseTopPin, romanizeKana, romanizerFor, wordProgress, type LyricsState, type Version } from "@/lyrics";
import type { TFunction } from "./i18n";
import { isLocalTiming } from "./wordTiming";

export { FRAME_MS, romanizeKana, romanizerFor };
export type { Line, LyricsState, LyricsStatus, RawLyrics, Version, Word, PinInput, ReleaseInput } from "@/lyrics";

const subscribe = (listener: () => void) => lyrics().subscribe(listener);

export function useLyrics<T>(selector: (state: LyricsState) => T): T {
  const read = () => selector(lyrics().getState());
  return useSyncExternalStore(subscribe, read, read);
}

export function versionLabel(version: Version, t: TFunction): string {
  if (version.label) return version.label;
  if (version.made === "transcribed") return t("ui.lyrics.version_written");
  if (isLocalTiming(version.provider)) return t("ui.lyrics.version_timed");
  if (version.topPriority) return t("ui.lyrics.version_own");
  if (version.syncLevel === "word_level" || version.syncLevel === "syllable_level") return t("ui.lyrics.version_word");
  if (version.syncLevel === "line_level") return t("ui.lyrics.version_synced");
  return t("ui.lyrics.version_plain");
}

export function lyricsErrorText(state: Pick<LyricsState, "status">, t: TFunction): string | null {
  return state.status === "error" ? t("ui.lyrics.load_failed") : null;
}

export const lyricsCommands = {
  follow: (track: Parameters<ReturnType<typeof lyrics>["follow"]>[0]) => void lyrics().follow(track),
  chooseVersion: (provider: string) => lyrics().chooseVersion(provider),
  changeOffset: (ms: number) => lyrics().changeOffset(ms),
  nudgeOffset: (deltaMs: number) => lyrics().nudgeOffset(deltaMs),
  clearOffset: () => lyrics().clearOffset(),
  clock: () => lyrics().clock(),
  onFrame: (listener: () => void) => lyrics().onFrame(listener),
  wordProgress,
  pinTopOnNewTrack,
  releaseTopPin,
};
