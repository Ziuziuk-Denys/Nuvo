/**
 * Daemon wire shapes the link features read and write.
 * shortcut: declared here until the phase-5 typed client exports them; then import them from there.
 */

import type { Cover as YtCover } from "@/youtube/types";

export interface ArtistRef {
  id: string;
  name: string;
}

/** A catalog cover, with the thumbnail to fall back on when it does not load. */
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
  /** Kept from a Deezer lookup; the daemon stores the snapshot as given. */
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

/** One row of `POST /v1/imports`. `track` makes the row Exact. */
export interface ImportRow {
  title: string;
  artists: string[];
  durationMs?: number;
  track?: CatalogTrack;
}

export type ImportTarget = { kind: "new" } | { kind: "liked" } | { kind: "playlist"; id: string };
