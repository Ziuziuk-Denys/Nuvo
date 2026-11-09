import { create } from "zustand";
import { toLyricsTrack, type LyricsTrack } from "../../ports/lyricsTools";

export type LyricsTool = "edit" | "translate";

interface LyricsToolsState {
  track: LyricsTrack | null;
  tool: LyricsTool | null;
  open(track: LyricsTrack, tool: LyricsTool): void;
  close(): void;
}

export const useLyricsTools = create<LyricsToolsState>((set) => ({
  track: null,
  tool: null,
  open: (track, tool) => set({ track: toLyricsTrack(track), tool }),
  close: () => set({ tool: null }),
}));

export function openLyricsTool(track: LyricsTrack, tool: LyricsTool): void {
  useLyricsTools.getState().open(track, tool);
}
