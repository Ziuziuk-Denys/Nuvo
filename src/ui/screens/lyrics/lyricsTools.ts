/** Which lyrics tool is open, for which track. The track stays set while the sheet fades out. */
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
