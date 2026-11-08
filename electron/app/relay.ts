/** One player state for every surface outside the renderer. */
import type { NotchAction, NotchState } from "../../src/notch/contracts";
import type { RemoteCommand, SurfaceState } from "../../src/engine/types";

export const IDLE_STATE: SurfaceState = {
  trackId: null,
  title: "",
  artists: "",
  durationMs: 0,
  positionMs: 0,
  sampledAt: 0,
  status: "idle",
  liked: false,
  source: "youtube",
  upNext: [],
};

export function toNotchState(state: SurfaceState): NotchState {
  return {
    track: state.trackId
      ? { id: state.trackId, title: state.title, artist: state.artists, coverUrl: state.publicCoverUrl ?? null, durationMs: state.durationMs }
      : null,
    status: state.trackId ? state.status : "idle",
    positionMs: state.positionMs,
    sampledAt: state.sampledAt,
    liked: state.liked,
    upNext: state.upNext.slice(0, 3).map((u) => ({ id: u.id, title: u.title, artist: u.artist, coverUrl: u.coverUrl || null, durationMs: u.durationMs })),
  };
}

/** Notch actions become player commands; focusApp stays a window action. The heart is a toggle, so it follows the current liked state. */
export function notchActionToCommand(action: NotchAction, liked: boolean): RemoteCommand | null {
  switch (action.type) {
    case "togglePlay":
      return { type: "toggle" };
    case "next":
      return { type: "next" };
    case "prev":
      return { type: "previous" };
    case "seek":
      return { type: "seek", positionMs: action.positionMs };
    case "like":
      return { type: liked ? "unlike" : "like" };
    case "volumeDelta":
      return { type: "volumeDelta", delta: action.delta };
    case "playUpNext":
      return { type: "playEntry", trackId: action.trackId };
    default:
      return null;
  }
}

export class PlayerRelay {
  private state: SurfaceState = IDLE_STATE;
  private readonly readers = new Set<(state: SurfaceState) => void>();

  get latest(): SurfaceState {
    return this.state;
  }

  read(reader: (state: SurfaceState) => void): () => void {
    this.readers.add(reader);
    reader(this.state);
    return () => this.readers.delete(reader);
  }

  accept(state: SurfaceState): void {
    this.state = state;
    for (const reader of this.readers) reader(state);
  }

  /** The renderer went away: every reader sees idle. */
  rendererGone(now: number): void {
    this.accept({ ...IDLE_STATE, sampledAt: now });
  }
}
