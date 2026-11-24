import { useEffect } from "react";
import type { NotchLyrics, NotchPlaylist, NotchSettings } from "@/notch/contracts";
import { usePlaylistAdds } from "./playlistAdds";
import { useNotchSettingsStore } from "./store/notchSettingsStore";

const MAX_PLAYLISTS = 30;

export interface NotchLyricsInput {
  trackId: string | null;
  lyricsTrackId: string | null;
  lines: NotchLyrics["lines"];
}

export interface NotchPlaylistInput {
  id: string;
  title: string;
  coverUrl: string;
  coverUrls: string[];
  trackCount: number;
  updatedAt?: string;
}

function pick(settings: NotchSettings): NotchSettings {
  const { mode, expandOn, showLyrics, pulseOnTrackChange, display, position, edge, offset, stacking } = settings;
  return { mode, expandOn, showLyrics, pulseOnTrackChange, display, position, edge, offset, stacking };
}

function latest(playlists: readonly NotchPlaylistInput[]): NotchPlaylist[] {
  return [...playlists]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MAX_PLAYLISTS)
    .map(({ id, title, coverUrl, coverUrls, trackCount }) => ({
      id,
      title: title.slice(0, 256),
      coverUrl: [coverUrl, ...coverUrls].find((url) => url.startsWith("https://")) ?? null,
      trackCount,
    }));
}

export function useNotchFeeds(lyrics: NotchLyricsInput, playlists: readonly NotchPlaylistInput[]): void {
  const { trackId, lyricsTrackId, lines } = lyrics;
  const outcome = usePlaylistAdds((state) => state.outcome);

  useEffect(() => {
    if (!trackId || lyricsTrackId !== trackId) return;
    window.nuvoShell?.notchUpdateLyrics({
      trackId,
      lines: lines.filter((line) => line.text.trim() !== "").map(({ timeMs, text, words }) => ({ timeMs, text, ...(words ? { words } : {}) })),
    });
  }, [trackId, lyricsTrackId, lines]);

  useEffect(() => {
    window.nuvoShell?.notchUpdatePlaylists({ items: latest(playlists), outcome });
  }, [playlists, outcome]);

  useEffect(() => {
    const send = (settings: NotchSettings) => window.nuvoShell?.notchUpdateSettings(pick(settings));
    send(useNotchSettingsStore.getState());
    return useNotchSettingsStore.subscribe(send);
  }, []);
}
