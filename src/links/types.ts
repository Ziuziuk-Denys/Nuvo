// shortcut: declared here until the typed client exports them, then import from there

import type { Cover as YtCover } from "@/youtube/types";

export interface ArtistRef {
  id: string;
  name: string;
}

export interface Cover extends YtCover {
  fallbackUrl?: string;
}

export interface CatalogTrack {
  id: string;
  title: string;
  artists: ArtistRef[];
  durationMs: number;
  cover?: Cover;
  explicit?: true;
  isrc?: string;
}

export type MatchFilter = "songs" | "any" | "videos";

export interface MatchSource {
  title: string;
  artists?: string[];
  durationMs?: number;
}

export interface MatchStep {
  query: string;
  filter: MatchFilter;
  failed: boolean;
  found: number;
}

export type PendingReason = "low_confidence_match" | "ambiguous_match" | "duration_mismatch" | "no_catalog_candidates" | "catalog_lookup_failed";

export type MatchAnswer =
  | { status: "approved"; track: CatalogTrack; score: number }
  | {
      status: "pending";
      reason: PendingReason;
      score?: number;
      proposedTrack?: CatalogTrack;
    }
  | { status: "search"; query: string; filter: MatchFilter };

export interface ImportRow {
  title: string;
  artists: string[];
  durationMs?: number;
  track?: CatalogTrack;
}

export type ImportTarget = { kind: "new" } | { kind: "liked" } | { kind: "playlist"; id: string };
