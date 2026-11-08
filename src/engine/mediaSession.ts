/** System media session (MPRIS through Chromium), transport 4.8. */
import type { PlayerView } from "./types";

export const DEFAULT_SEEK_OFFSET_S = 10;

export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  setPositionState?(state?: MediaPositionState): void;
}

export interface SessionControls {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seekTo(positionMs: number): void;
  positionMs(): number;
  durationMs(): number;
}

type MetadataFactory = (init: MediaMetadataInit) => MediaMetadata;
type ArtworkSource = (coverUrl: string) => Promise<string | null>;

/** A clear picture: with no artwork at all Chromium leaves the last track's cover in MPRIS, and it drops images this side of 72 px. */
const NO_ARTWORK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAQAAABpN6lAAAAAN0lEQVR42u3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAtwGAgAABfY2TzQAAAABJRU5ErkJggg==";

const ACTIONS: MediaSessionAction[] = ["play", "pause", "stop", "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto"];

export function bindMediaSession(session: MediaSessionLike, controls: SessionControls): () => void {
  const seekBy = (offsetS: number) => {
    const target = Math.min(controls.durationMs(), Math.max(0, controls.positionMs() + offsetS * 1000));
    controls.seekTo(target);
  };
  session.setActionHandler("play", () => controls.play());
  session.setActionHandler("pause", () => controls.pause());
  session.setActionHandler("stop", () => controls.pause());
  session.setActionHandler("previoustrack", () => controls.previous());
  session.setActionHandler("nexttrack", () => controls.next());
  session.setActionHandler("seekbackward", (details) => seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET_S)));
  session.setActionHandler("seekforward", (details) => seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET_S));
  session.setActionHandler("seekto", (details) => {
    if (typeof details.seekTime === "number" && Number.isFinite(details.seekTime)) controls.seekTo(details.seekTime * 1000);
  });
  return () => {
    for (const action of ACTIONS) session.setActionHandler(action, null);
  };
}

/**
 * The session takes http, https, data and blob artwork, so a cover behind the daemon bridge is handed over
 * as data: the OS surfaces see the picture, never the bridge, its token or a path.
 */
export async function artworkData(url: string, doFetch: typeof fetch): Promise<string | null> {
  const response = await doFetch(url);
  if (!response.ok) return null;
  const picture = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(picture);
  });
}

export class MediaSessionMirror {
  private trackId: string | null = null;

  constructor(
    private readonly session: MediaSessionLike,
    private readonly metadata: MetadataFactory,
    private readonly artwork: ArtworkSource = async () => null,
  ) {}

  /** Clears the system session (engine disposal). */
  release(): void {
    this.session.playbackState = "none";
    this.session.metadata = null;
    this.trackId = null;
  }

  /** `deckHoldsCurrent`: the active deck already plays the current entry (position state is only set then). */
  update(view: PlayerView, deckHoldsCurrent: boolean): void {
    const track = view.current?.track ?? null;
    this.session.playbackState = view.status === "idle" ? "none" : view.status === "paused" ? "paused" : "playing";
    if (view.status === "idle" || !track) {
      this.session.metadata = null;
      this.trackId = null;
      return;
    }
    if (track.id !== this.trackId) {
      this.trackId = track.id;
      const init = { title: track.title, artist: track.artists, album: track.album?.title ?? "" };
      const showArtwork = (src: string | null) => {
        if (this.trackId === track.id) this.session.metadata = this.metadata({ ...init, artwork: [{ src: src ?? NO_ARTWORK }] });
      };
      showArtwork(null);
      if (track.coverUrl) {
        this.artwork(track.coverUrl).then(
          (src) => {
            if (src) showArtwork(src);
          },
          () => undefined,
        );
      }
    }
    if (deckHoldsCurrent && Number.isFinite(view.durationMs) && view.durationMs > 0) {
      this.session.setPositionState?.({
        duration: view.durationMs / 1000,
        playbackRate: view.tempo.rate,
        position: Math.min(view.durationMs, Math.max(0, view.positionMs)) / 1000,
      });
    }
  }
}
