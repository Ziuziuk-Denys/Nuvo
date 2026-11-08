/**
 * Wire shapes of the daemon's import job (`POST /v1/imports` and the report routes) and the
 * listing result the link listers produce. Field names follow `nuvo-contracts` (camelCase).
 */

export interface CatalogTrack {
  id: string;
  title: string;
  artists: { id: string; name: string }[];
  album?: { id: string; title: string };
  durationMs: number;
  cover?: { url: string; width?: number; height?: number };
  explicit?: boolean;
}

/** One source line. `track` names a playable YouTube or SoundCloud track and makes the row Exact. */
export interface ImportRow {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  track?: CatalogTrack;
}

/** Sources the daemon accepts for rows listed in the renderer. */
export type RowSource = "youtube-music" | "soundcloud" | "apple-music" | "deezer" | "spotify";

export type ImportTarget = { kind: "new" } | { kind: "liked" } | { kind: "playlist"; id: string };

export type ListingNotice =
  /** The source page showed fewer songs than the playlist has; `total` when the source said it. */
  | { kind: "partial"; shown: number; total?: number }
  /** The listing stopped at the daemon's row cap. */
  | { kind: "capped"; kept: number }
  /** The source stopped answering part way: these rows are all that was read. */
  | { kind: "cut"; kept: number };

/** What a link lister read. An empty `label` means "use the source's default name". */
export interface Listing {
  source: RowSource;
  label: string;
  rows: ImportRow[];
  notice?: ListingNotice;
  /** Set for a SoundCloud likes listing: the label becomes "{name}: Likes". */
  likesOf?: string;
}

export interface ImportCounts {
  exact: number;
  likely: number;
  check: number;
  missing: number;
  already: number;
}

export interface ImportSummary {
  id: string;
  sourceKind: string;
  label: string;
  targetKind: "playlist" | "liked";
  targetId?: string;
  createdAt: string;
  status: "running" | "done";
  total: number;
  done: number;
  needsReview: number;
  counts: ImportCounts;
}

export type ReportLabel = "exact" | "likely" | "check" | "missing" | "already";

export type ReportReason =
  "exact" | "matched" | "already_there" | "low_confidence_match" | "ambiguous_match" | "duration_mismatch" | "no_catalog_candidates" | "catalog_lookup_failed";

export type Decision = "use" | "pick" | "remove" | "keep";

export interface ReportRow {
  id: number;
  position: number;
  source: ImportRow;
  label?: ReportLabel;
  score?: number;
  reason?: ReportReason;
  track?: CatalogTrack;
  candidates: CatalogTrack[];
  decision?: Decision;
  durationDiffMs?: number;
}

/** `review` is the report's default chip: Check and Missing rows nobody decided on. */
export type RowsFilter = "review" | "matched" | "all" | ReportLabel;

export interface RowsPage {
  items: ReportRow[];
  nextCursor?: string;
}

export interface ImportSearch {
  query: string;
  filter: "songs" | "any" | "videos";
  source: "youtube" | "soundcloud";
  step: number;
}

export type ImportNext = { rowId: number; search: ImportSearch } | { wait: number } | { done: true };

export type ImportErrorCode =
  | "not_a_link"
  | "unsupported_host"
  | "bad_link"
  | "spotify_file_only"
  | "yandex_lists"
  | "login_required"
  | "missing_name"
  | "bad_file"
  | "file_too_large"
  | "empty"
  | "gone"
  | "source_changed"
  | "network"
  /** Some pages are imported, a later one could not be posted. */
  | "cut"
  | "locked"
  | "daemon";

/** A failed import step. `host` names the refused host for `unsupported_host`. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly host?: string,
  ) {
    super(host ? `${code}: ${host}` : code);
    this.name = "ImportError";
  }
}

/** Rows per import (the daemon's cap). */
export const MAX_ROWS = 20_000;
/** Playlist titles are cut here before they reach the daemon. */
export const MAX_LABEL_CHARS = 200;
