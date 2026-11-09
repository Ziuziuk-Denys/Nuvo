export type YtCode =
  | "bad-id"
  | "bad-url"
  | "not-found"
  | "empty-playlist"
  | "unreachable"
  | "http"
  | "bad-json"
  | "unplayable"
  | "bot-check"
  | "sign-in-required"
  | "no-formats"
  | "rejected-stream"
  | "unsupported-mime"
  | "needs-desktop"
  | "no-match"
  | "all-failed"
  | `auth:${string}`
  | "worker-start"
  | "worker-closed"
  | "worker-timeout"
  | "bad-input";

export interface YtAttempt {
  client: string;
  code: string;
  text: string;
  status?: number;
}

export class YtError extends Error {
  readonly code: YtCode;
  readonly status?: number;
  readonly botCheck: boolean;
  readonly attempts?: YtAttempt[];

  constructor(
    code: YtCode,
    options: {
      status?: number;
      botCheck?: boolean;
      attempts?: YtAttempt[];
      text?: string;
    } = {},
  ) {
    super(options.text ?? code);
    this.name = "YtError";
    this.code = code;
    this.status = options.status;
    this.botCheck = options.botCheck ?? code === "bot-check";
    this.attempts = options.attempts;
  }
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export interface Cover {
  url: string;
  width: number;
  height: number;
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface AlbumRef {
  id: string;
  title: string;
}

export interface YtTrack {
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationMs: number;
  cover?: Cover;
  explicit: boolean;
}

export interface TrackPage extends YtTrack {
  year?: number;
}

export type SearchItem =
  | ({ kind: "track" } & YtTrack)
  | { kind: "artist"; id: string; name: string; cover?: Cover }
  | {
      kind: "album";
      id: string;
      title: string;
      artists: ArtistRef[];
      year?: number;
      cover?: Cover;
    }
  | {
      kind: "playlist";
      id: string;
      title: string;
      author?: string;
      cover?: Cover;
    };

export type SearchKind = "all" | "track" | "artist" | "album" | "playlist";
export type SearchFilter = "track" | "video" | "artist" | "album" | "playlist";

export interface AlbumPage {
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: number;
  cover?: Cover;
  trackCount?: number;
  tracks: YtTrack[];
}

export interface Release {
  id: string;
  title: string;
  year?: number;
  cover?: Cover;
  explicit: boolean;
}

export interface Single extends Release {
  releaseKind: "single" | "ep";
}

export interface ArtistPage {
  id: string;
  name: string;
  verified: boolean;
  cover?: Cover;
  listenersText?: string;
  tracks: YtTrack[];
  albums: Release[];
  singles: Single[];
}

export interface PlaylistPage {
  id: string;
  title: string;
  author?: string;
  description?: string;
  year?: number;
  cover?: Cover;
  trackCount?: number;
  tracks: YtTrack[];
  more?: (signal: AbortSignal) => Promise<YtTrack[]>;
}

export interface ImportedTrack {
  ytId: string;
  title: string;
  artistTexts: string[];
  artistChannelIds: string[];
  albumTitle?: string;
  albumBrowseId?: string;
  durationMs?: number;
  coverUrl: string;
}

export interface ImportedList {
  source: "youtube";
  sourceUrl: string;
  title: string;
  description?: string;
  tracks: ImportedTrack[];
}

export interface DeviceCode {
  shownCode: string;
  verifyLink: string;
  verifyLinkWithCode: string;
  validUntilMs: number;
  pollEveryMs: number;
}

export interface YtCatalog {
  search(query: string, kind: SearchKind, signal: AbortSignal): Promise<SearchItem[]>;
  searchFiltered(query: string, filter: SearchFilter | undefined, signal: AbortSignal): Promise<SearchItem[]>;
  track(id: string, signal: AbortSignal): Promise<TrackPage>;
  album(id: string, signal: AbortSignal): Promise<AlbumPage>;
  artist(id: string, signal: AbortSignal): Promise<ArtistPage>;
  artistImage(id: string, signal: AbortSignal): Promise<Cover | undefined>;
  playlist(id: string, signal: AbortSignal): Promise<PlaylistPage>;
  radio(id: string, options: { limit?: number; exclude?: ReadonlySet<string> }, signal: AbortSignal): Promise<YtTrack[]>;
  importUrl(url: string, signal: AbortSignal): Promise<ImportedList>;
  parseUrl(url: string): { videoId?: string; playlistId?: string } | undefined;
}
