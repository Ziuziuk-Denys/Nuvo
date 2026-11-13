export interface CatalogTrack {
  id: string;
  title: string;
  artists: { id: string; name: string }[];
  album?: { id: string; title: string };
  durationMs: number;
  cover?: { url: string; width?: number; height?: number };
  explicit?: boolean;
}

export interface ImportRow {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  track?: CatalogTrack;
}

export type RowSource = "youtube-music" | "soundcloud" | "apple-music" | "deezer" | "spotify" | "yandex-music";

export type ImportTarget = { kind: "new" } | { kind: "liked" } | { kind: "playlist"; id: string };

export type ListingNotice = { kind: "partial"; shown: number; total?: number } | { kind: "capped"; kept: number } | { kind: "cut"; kept: number };

export interface Listing {
  source: RowSource;
  label: string;
  rows: ImportRow[];
  notice?: ListingNotice;
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
  | "region_blocked"
  | "login_required"
  | "missing_name"
  | "bad_file"
  | "file_too_large"
  | "empty"
  | "gone"
  | "source_changed"
  | "network"
  | "cut"
  | "locked"
  | "daemon";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly host?: string,
  ) {
    super(host ? `${code}: ${host}` : code);
    this.name = "ImportError";
  }
}

export const MAX_ROWS = 20_000;
export const MAX_LABEL_CHARS = 200;
