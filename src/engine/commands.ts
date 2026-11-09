import { volumeAfterDelta } from "./tempo";
import type { PlayerView, Track } from "./types";

export interface CommandTarget {
  getView(): PlayerView;
  toggle(): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seekTo(positionMs: number): void;
  playEntry(entryId: string): void;
  changeVolume(gain: number): void;
}

export interface LibraryPort {
  like(trackId: string): void;
  unlike(trackId: string): void;
  dislike?(track: Track): void;
}

export function runCommand(engine: CommandTarget, library: LibraryPort, command: unknown): void {
  if (!command || typeof command !== "object") return;
  const c = command as Record<string, unknown>;
  const view = engine.getView();
  switch (c.type) {
    case "toggle":
      return engine.toggle();
    case "play":
      return engine.play();
    case "pause":
      return engine.pause();
    case "next":
      return engine.next();
    case "previous":
      return engine.previous();
    case "seek": {
      if (!view.current) return;
      const ms = c.positionMs;
      const limit = view.durationMs || view.current.track.durationMs || 0;
      if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= limit) engine.seekTo(ms);
      return;
    }
    case "playEntry": {
      if (typeof c.trackId !== "string") return;
      const entry = view.entries.slice(view.index + 1).find((e) => e.track.id === c.trackId);
      if (entry) engine.playEntry(entry.entryId);
      return;
    }
    case "volumeDelta":
      if (typeof c.delta === "number" && Number.isFinite(c.delta) && Math.abs(c.delta) <= 1) engine.changeVolume(volumeAfterDelta(view.volume, c.delta));
      return;
    case "like":
    case "unlike": {
      const id = view.current?.track.id;
      if (!id) return;
      if (c.type === "like") library.like(id);
      else library.unlike(id);
      return;
    }
    case "dislike": {
      const track = view.current?.track;
      if (track) library.dislike?.(track);
      return;
    }
  }
}
