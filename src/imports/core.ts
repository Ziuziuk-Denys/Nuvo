/**
 * Typed client for the daemon's import routes and the SoundCloud import
 * listing. Calls go through Electron main's `nuvo-core://local` bridge, which adds the token.
 */
import type { CatalogTrack, Decision, ImportNext, ImportRow, ImportSummary, ImportTarget, Listing, ReportRow, RowSource, RowsFilter, RowsPage } from "./types";
import type { FetchLike } from "./http";
import type { PendingJob } from "./pending";

/** A failed daemon call: `status` 0 when the daemon could not be reached. */
export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "CoreError";
  }

  /** The cases a caller tells apart: a locked vault, a daemon still starting, a hung or unreachable one. */
  get kind(): "locked" | "starting" | "timeout" | "down" | "http" {
    if (this.status === 423) return "locked";
    if (this.status === 503) return "starting";
    if (this.code === "CORE_TIMEOUT") return "timeout";
    if (this.status === 0) return "down";
    return "http";
  }
}

export type StartBody =
  | { file: { name: string; data: string }; target?: ImportTarget }
  | {
      source: RowSource;
      label: string;
      rows: ImportRow[];
      target?: ImportTarget;
    };

export interface ImportsDaemon {
  start(body: StartBody, signal?: AbortSignal): Promise<ImportSummary[]>;
  /** A later page of a listing posted in pages; earlier pages stay whatever happens. */
  appendRows(id: string, rows: ImportRow[], signal?: AbortSignal): Promise<ImportSummary>;
  list(signal?: AbortSignal): Promise<ImportSummary[]>;
  summary(id: string, signal?: AbortSignal): Promise<ImportSummary>;
  remove(id: string): Promise<void>;
  next(id: string, signal?: AbortSignal): Promise<ImportNext>;
  postCandidates(id: string, rowId: number, body: { step: number; candidates: CatalogTrack[]; failed?: boolean }, signal?: AbortSignal): Promise<ReportRow>;
  rows(id: string, filter: RowsFilter, cursor?: string, signal?: AbortSignal): Promise<RowsPage>;
  decide(id: string, rowId: number, decision: Decision, track?: CatalogTrack): Promise<ReportRow>;
  bulk(id: string, action: "accept-check" | "retry-failed"): Promise<ImportSummary>;
  reportCsv(id: string): Promise<string>;
  /**
   * Adds one track at the end of a playlist (the waiting song of "Add to playlist"). Goes through
   * the bulk route, which skips a song already there, so repeating the call is harmless.
   */
  addToPlaylist(playlistId: string, track: CatalogTrack): Promise<void>;
  /** The song waiting for its new playlist, kept in the library across a restart. */
  pendingTrack(): Promise<PendingJob | null>;
  savePendingTrack(job: PendingJob): Promise<void>;
  clearPendingTrack(): Promise<void>;
  /** `GET /v1/sc/import`: a SoundCloud track, set or likes link as Exact rows. */
  soundcloudListing(url: string, signal?: AbortSignal): Promise<Listing>;
  /** `GET /v1/spotify/import`: a public Spotify playlist or album link, read by the daemon from the embed page and, past 100 songs, the web player's query. */
  spotifyListing(url: string, signal?: AbortSignal): Promise<Listing>;
  /** `GET /v1/sc/search`: the cascade's SoundCloud step. */
  soundcloudSearch(query: string, signal?: AbortSignal): Promise<CatalogTrack[]>;
}

export const ROWS_PAGE = 100;
const PENDING_PATH = "/v1/imports/pending-track";

export function createImportsDaemon(base: string, fetchFn: FetchLike = (url, init) => fetch(url, init)): ImportsDaemon {
  async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new CoreError(0, "CORE_DOWN");
    }
    if (!response.ok) {
      const answer = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new CoreError(response.status, typeof answer.code === "string" ? answer.code : "UPSTREAM");
    }
    return response;
  }
  const call = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await send(method, path, body, signal);
    try {
      return (await response.json()) as T;
    } catch {
      throw new CoreError(response.status, "UPSTREAM");
    }
  };
  const id = encodeURIComponent;

  return {
    start: async (body, signal) => (await call<{ items: ImportSummary[] }>("POST", "/v1/imports", body, signal)).items,
    appendRows: (importId, rows, signal) => call("POST", `/v1/imports/${id(importId)}/rows`, { rows }, signal),
    list: async (signal) => (await call<{ items: ImportSummary[] }>("GET", "/v1/imports", undefined, signal)).items,
    summary: (importId, signal) => call("GET", `/v1/imports/${id(importId)}`, undefined, signal),
    remove: async (importId) => {
      await send("DELETE", `/v1/imports/${id(importId)}`);
    },
    next: (importId, signal) => call("POST", `/v1/imports/${id(importId)}/next`, undefined, signal),
    postCandidates: (importId, rowId, body, signal) => call("POST", `/v1/imports/${id(importId)}/rows/${rowId}/candidates`, body, signal),
    rows: (importId, filter, cursor, signal) => {
      const query = new URLSearchParams({
        label: filter,
        limit: String(ROWS_PAGE),
        ...(cursor ? { cursor } : {}),
      });
      return call("GET", `/v1/imports/${id(importId)}/rows?${query}`, undefined, signal);
    },
    decide: (importId, rowId, decision, track) => call("PATCH", `/v1/imports/${id(importId)}/rows/${rowId}`, track ? { decision, track } : { decision }),
    bulk: (importId, action) => call("POST", `/v1/imports/${id(importId)}/bulk`, { action }),
    reportCsv: async (importId) => (await send("GET", `/v1/imports/${id(importId)}/report.csv`)).text(),
    addToPlaylist: async (playlistId, track) => {
      const result = await call<{ added: number; rejected: number }>("POST", `/v1/me/playlists/${id(playlistId)}/tracks`, { tracks: [track] });
      if (result.rejected > 0) throw new CoreError(400, "INVALID_INPUT");
    },
    pendingTrack: async () => (await call<{ job: PendingJob | null }>("GET", PENDING_PATH)).job,
    savePendingTrack: async (job) => {
      await send("PUT", PENDING_PATH, job);
    },
    clearPendingTrack: async () => {
      await send("DELETE", PENDING_PATH);
    },
    soundcloudListing: async (url, signal) => {
      const answer = await call<{
        label: string;
        likesOf?: string;
        partial?: boolean;
        rows: ImportRow[];
      }>("GET", `/v1/sc/import?url=${encodeURIComponent(url)}`, undefined, signal);
      return {
        source: "soundcloud",
        label: answer.label,
        rows: answer.rows,
        ...(answer.likesOf ? { likesOf: answer.likesOf } : {}),
        ...(answer.partial ? { notice: { kind: "cut" as const, kept: answer.rows.length } } : {}),
      };
    },
    spotifyListing: async (url, signal) => {
      const answer = await call<{
        label: string;
        rows: ImportRow[];
        partial?: boolean;
        total?: number;
      }>("GET", `/v1/spotify/import?url=${encodeURIComponent(url)}`, undefined, signal);
      return {
        source: "spotify",
        label: answer.label,
        rows: answer.rows,
        ...(answer.partial ? { notice: { kind: "partial" as const, shown: answer.rows.length, total: answer.total } } : {}),
      };
    },
    soundcloudSearch: async (query, signal) => {
      const params = new URLSearchParams({ q: query, limit: "25" });
      return (await call<{ items: CatalogTrack[] }>("GET", `/v1/sc/search?${params}`, undefined, signal)).items;
    },
  };
}
