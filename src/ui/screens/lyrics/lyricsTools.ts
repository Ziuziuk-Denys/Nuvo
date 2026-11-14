import { create } from "zustand";
import { toLyricsTrack, type LyricsTrack } from "../../ports/lyricsTools";

export type LyricsTool = "edit" | "translate";

interface LyricsToolsState {
  track: LyricsTrack | null;
  tool: LyricsTool | null;
  draft: string | null;
  open(track: LyricsTrack, tool: LyricsTool, draft?: string): void;
  close(): void;
}

export const useLyricsTools = create<LyricsToolsState>((set) => ({
  track: null,
  tool: null,
  draft: null,
  open: (track, tool, draft) => set({ track: toLyricsTrack(track), tool, draft: draft ?? null }),
  close: () => set({ tool: null }),
}));

export function openLyricsTool(track: LyricsTrack, tool: LyricsTool, draft?: string): void {
  useLyricsTools.getState().open(track, tool, draft);
}
