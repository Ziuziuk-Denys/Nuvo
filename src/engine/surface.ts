import { idKind, primarySource, type PlayerView, type SurfaceState, type SurfaceUpNext } from "./types";

export const SURFACE_STRING_MAX = 256;
export const UP_NEXT_MAX = 3;
export const SEND_INTERVAL_MS = 250;
export const HEARTBEAT_MS = 2000;
export const SEEK_JUMP_MS = 750;
const MAX_POSITION_MS = 86_400_000;

// YouTube Music serves song artwork from yt3.googleusercontent.com, older artwork from lh3
const PUBLIC_COVER_HOSTS = ["i.ytimg.com", "lh3.googleusercontent.com", "yt3.googleusercontent.com", "yt3.ggpht.com"];

/** Limits main's validator applies to the whole state; one longer URL would drop everything. */
const SOUNDCLOUD_PAGE_MAX = "https://soundcloud.com/".length + 512;
const COVER_URL_MAX = 2048;

const cut = (text: string) => text.slice(0, SURFACE_STRING_MAX);
const clampMs = (ms: number) => Math.min(MAX_POSITION_MS, Math.max(0, Number.isFinite(ms) ? ms : 0));

// Only https covers on public image hosts; never nuvo-core:, data:, blob: or custom covers
export function publicCover(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
    const host = parsed.hostname;
    if (!PUBLIC_COVER_HOSTS.includes(host) && !host.endsWith(".sndcdn.com")) return undefined;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.href.length <= COVER_URL_MAX ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function sourcePage(trackId: string, permalinkUrl?: string): string | undefined {
  if (idKind(trackId) === "youtube") return `https://music.youtube.com/watch?v=${trackId}`;
  if (permalinkUrl?.startsWith("https://soundcloud.com/")) {
    try {
      const parsed = new URL(permalinkUrl);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      return parsed.href.length <= SOUNDCLOUD_PAGE_MAX ? parsed.href : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function toSurfaceState(view: PlayerView, extra: { liked: boolean; now: number }): SurfaceState {
  const track = view.current?.track;
  if (!track) {
    return {
      trackId: null,
      title: "",
      artists: "",
      durationMs: 0,
      positionMs: 0,
      sampledAt: extra.now,
      status: "idle",
      liked: false,
      source: "youtube",
      upNext: [],
    };
  }
  const upNext: SurfaceUpNext[] = view.entries.slice(view.index + 1, view.index + 1 + UP_NEXT_MAX).map((e) => ({
    id: e.track.id,
    title: cut(e.track.title),
    artist: cut(e.track.artists),
    // not cut to the text limit: a shortened URL is a broken image; publicCover already caps the length
    coverUrl: publicCover(e.track.coverUrl) ?? "",
    durationMs: clampMs(e.track.durationMs),
  }));
  const page = sourcePage(track.id, track.permalinkUrl);
  const cover = publicCover(track.coverUrl);
  return {
    trackId: track.id.slice(0, SURFACE_STRING_MAX),
    title: cut(track.title),
    artists: cut(track.artists),
    ...(track.album?.title ? { album: cut(track.album.title) } : {}),
    durationMs: clampMs(view.durationMs || track.durationMs),
    positionMs: clampMs(view.positionMs),
    sampledAt: extra.now,
    status: view.status,
    ...(view.status === "paused" && view.pauseReason ? { pauseReason: view.pauseReason } : {}),
    liked: extra.liked,
    source: view.stream?.source ?? primarySource(track.id),
    ...(page ? { sourcePageUrl: page } : {}),
    ...(cover ? { publicCoverUrl: cover } : {}),
    ...(view.stream && view.stream.bitrateKbps > 0
      ? { stream: { codec: view.stream.codec.slice(0, 16), bitrateKbps: Math.min(2000, view.stream.bitrateKbps) } }
      : {}),
    upNext,
  };
}

function key(state: SurfaceState): string {
  return [state.trackId, state.status, state.pauseReason, state.liked, state.source, state.upNext.map((u) => u.id).join(",")].join("|");
}

export class SurfaceSender {
  private last: SurfaceState | null = null;
  private lastSentAt = -Infinity;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly build: () => SurfaceState,
    private readonly send: (state: SurfaceState) => void,
    private readonly now: () => number,
  ) {}

  poke(): void {
    if (this.disposed) return;
    const next = this.build();
    const last = this.last;
    if (!last || key(next) !== key(last) || this.jumped(next, last)) this.schedule();
  }

  private jumped(next: SurfaceState, last: SurfaceState): boolean {
    const expected = last.status === "playing" ? last.positionMs + (next.sampledAt - last.sampledAt) : last.positionMs;
    return Math.abs(next.positionMs - expected) > SEEK_JUMP_MS;
  }

  private schedule(): void {
    if (this.pending) return;
    const wait = this.lastSentAt + SEND_INTERVAL_MS - this.now();
    if (wait <= 0) {
      this.emit();
      return;
    }
    this.pending = setTimeout(() => {
      this.pending = null;
      this.emit();
    }, wait);
  }

  private emit(): void {
    const state = this.build();
    this.last = state;
    this.lastSentAt = this.now();
    this.send(state);
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = state.status === "playing" ? setTimeout(() => this.schedule(), HEARTBEAT_MS) : null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pending) clearTimeout(this.pending);
    if (this.heartbeat) clearTimeout(this.heartbeat);
  }
}
