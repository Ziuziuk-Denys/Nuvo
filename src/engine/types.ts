export interface Track {
  id: string;
  title: string;
  artists: string;
  artistId?: string;
  artistList?: Array<{ id?: string; name: string }>;
  album?: { id: string; title: string };
  coverUrl: string;
  durationMs: number;
  playCount?: number;
  explicit?: boolean;
  releaseDate?: string;
  playlistItemId?: string;
  permalinkUrl?: string;
}

export type Origin = "list" | "next" | "queued" | "continuation";

export interface RankReason {
  // Later kinds may appear: readers must skip unknown ones
  kind: string;
  name?: string;
}

export interface QueueEntry {
  entryId: string;
  track: Track;
  origin: Origin;
  order: number;
  reason?: RankReason;
}

export interface TuningState {
  playbackRate: number;
  pitchSemitones: number;
  isPitchLinked: boolean;
  keepSpeedAcrossTracks: boolean;
  isReverbEnabled: boolean;
  reverbLevel: number;
}

export type Status = "idle" | "loading" | "playing" | "paused";
export type PauseReason = "user" | "device_lost" | "autoplay_blocked" | "sign_in" | "network" | "sleep";
export type RepeatMode = "off" | "all" | "one";
export type SourceKind = "youtube" | "soundcloud" | "cache" | "local";

export type Cause =
  | "offline"
  | "dns_failed"
  | "blocked"
  | "tls_intercepted"
  | "proxy_failed"
  | "rate_limited"
  | "server_error"
  | "unavailable"
  | "timeout"
  | "drm"
  | "sign_in_required"
  | "not_audio";

export const NETWORK_CAUSES: ReadonlySet<Cause> = new Set(["offline", "dns_failed", "blocked", "timeout", "proxy_failed"]);

export interface StreamInfo {
  source: SourceKind;
  codec: string;
  bitrateKbps: number;
  fromCache: boolean;
}

export interface FallbackInfo {
  primarySource: SourceKind;
  usedSource: SourceKind;
  cause: Cause | "stall" | "http_403" | "media_error";
  score: number;
  restarted: boolean;
}

export interface Notice {
  kind: "skipped" | "network" | "queue_failed";
  title?: string;
  cause?: string;
}

export interface OutputDevice {
  id: string;
  label: string;
}

export interface OutputView {
  chosen: OutputDevice | null;
  active: OutputDevice;
  fellBack: boolean;
  error?: string;
  silent?: "system_muted" | "output_stopped";
}

export interface TempoView {
  rate: number;
  semitones: number;
  linked: boolean;
  keepAcrossTracks: boolean;
}

export interface PlayerView {
  status: Status;
  pauseReason: PauseReason | null;
  entries: QueueEntry[];
  index: number;
  current: QueueEntry | null;
  positionMs: number;
  durationMs: number;
  context: string | null;
  listCover: string | null;
  continuing: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  tempo: TempoView;
  reverb: { on: boolean; level: number };
  output: OutputView;
  bestQuality: boolean;
  stream: StreamInfo | null;
  fallback: FallbackInfo | null;
  notice: Notice | null;
}

export type RemoteCommand =
  | { type: "toggle" | "play" | "pause" | "next" | "previous" | "like" | "unlike" | "dislike" }
  | { type: "seek"; positionMs: number }
  | { type: "playEntry"; trackId: string }
  | { type: "volumeDelta"; delta: number };

export interface SurfaceUpNext {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  durationMs: number;
}

export interface SurfaceState {
  trackId: string | null;
  title: string;
  artists: string;
  album?: string;
  durationMs: number;
  positionMs: number;
  sampledAt: number;
  status: Status;
  pauseReason?: PauseReason;
  liked: boolean;
  source: SourceKind;
  sourcePageUrl?: string;
  publicCoverUrl?: string;
  stream?: { codec: string; bitrateKbps: number };
  upNext: SurfaceUpNext[];
}

export const SYSTEM_DEFAULT: OutputDevice = { id: "", label: "System default" };

export function splitContext(context: string | null): { type: string; id?: string } | null {
  if (!context) return null;
  const at = context.indexOf(":");
  return at < 0 ? { type: context } : { type: context.slice(0, at), id: context.slice(at + 1) };
}

export function isStation(context: string | null): boolean {
  return splitContext(context)?.type === "radio";
}

export function isSoundCloudId(id: string): boolean {
  return /^sc:\d+$/.test(id);
}

export function isYoutubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

export function isLocalId(id: string): boolean {
  return /^local:[0-9a-f]{32}$/.test(id);
}

export function idKind(id: string): "youtube" | "soundcloud" | "local" | "other" {
  if (isLocalId(id)) return "local";
  if (isSoundCloudId(id)) return "soundcloud";
  if (isYoutubeId(id)) return "youtube";
  return "other";
}

export function primarySource(id: string): SourceKind {
  const kind = idKind(id);
  return kind === "soundcloud" || kind === "local" ? kind : "youtube";
}
