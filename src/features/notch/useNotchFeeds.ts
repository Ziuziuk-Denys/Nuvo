import { useEffect } from "react";
import type { NotchSettings } from "@/notch/contracts";
import { useNotchSettingsStore } from "./store/notchSettingsStore";

export interface NotchLyricsInput {
  trackId: string | null;
  lyricsTrackId: string | null;
  lines: Array<{ timeMs: number; text: string }>;
}

function pick(settings: NotchSettings): NotchSettings {
  const { mode, expandOn, showLyrics, pulseOnTrackChange, display } = settings;
  return { mode, expandOn, showLyrics, pulseOnTrackChange, display };
}

export function useNotchFeeds(lyrics: NotchLyricsInput): void {
  const { trackId, lyricsTrackId, lines } = lyrics;

  useEffect(() => {
    if (!trackId || lyricsTrackId !== trackId) return;
    window.nuvoShell?.notchUpdateLyrics({ trackId, lines: lines.filter((line) => line.text.trim() !== "").map(({ timeMs, text }) => ({ timeMs, text })) });
  }, [trackId, lyricsTrackId, lines]);

  useEffect(() => {
    const send = (settings: NotchSettings) => window.nuvoShell?.notchUpdateSettings(pick(settings));
    send(useNotchSettingsStore.getState());
    return useNotchSettingsStore.subscribe(send);
  }, []);
}
