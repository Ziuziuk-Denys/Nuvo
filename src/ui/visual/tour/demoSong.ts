import { playerEngine, usePlayerStore, type Track } from "../../ports/player";

// the official audio, whose synced lyrics on LRCLIB were checked against it
export const DEMO_TRACK: Track = { id: "fHI8X4OXluQ", title: "Blinding Lights", artists: "The Weeknd", coverUrl: "", durationMs: 203_000 };

export interface Playback {
  queue: Track[];
  index: number;
  positionMs: number;
  context: string | null;
  cover: string | null;
  playing: boolean;
}

export function playDemo(): Playback | null {
  const state = usePlayerStore.getState();
  const before = state.currentTrack
    ? {
        queue: state.queue,
        index: state.currentIndex,
        positionMs: state.positionMs,
        context: state.playbackContext,
        cover: state.playbackContextCover,
        playing: state.status === "playing" || state.status === "loading",
      }
    : null;
  playerEngine.playTrack(DEMO_TRACK);
  return before;
}

export function restorePlayback(before: Playback | null): void {
  const track = before?.queue[before.index];
  if (!before || !track) {
    playerEngine.pause();
    return;
  }
  playerEngine.playTrack(track, before.queue, before.context, before.cover, before.index);
  playerEngine.seek(before.positionMs);
  if (!before.playing) playerEngine.pause();
}
