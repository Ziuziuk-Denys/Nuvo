/** The renderer's view of music folders and saves: daemon routes only, never a filesystem path. */
import { fromSnapshot } from "@/engine/snapshot";
import type { Track } from "@/engine/types";

export interface LocalRootView {
  id: number;
  path: string;
  status: "ok" | "missing";
  files: number;
  lastScanAt: number | null;
}

export interface LocalScanView {
  scanning: boolean;
  rootId: number | null;
  total: number;
  read: number;
  added: number;
  updated: number;
  removed: number;
  unreadable: number;
  skippedLinks: number;
  truncated: boolean;
  watching: number;
  polling: boolean;
  lastScanAt: number | null;
}

export interface LocalTrackView {
  track: Track;
  codec: string;
  bitrateKbps: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  lossless: boolean;
  unsupported: string | null;
  hasLyrics: boolean;
}

export interface DownloadView {
  id: string;
  label: string;
  dir: string;
  format: string;
  status: "running" | "done" | "cancelled" | string;
  total: number;
  done: number;
  failed: number;
  waiting: number;
  createdAt: number;
}

interface RawItem extends Omit<LocalTrackView, "track" | "unsupported"> {
  track: unknown;
  unsupported?: string;
}

const PAGE = 500;

export function createLocalClient(base: string, doFetch: typeof fetch = (input, init) => fetch(input, init)) {
  const get = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await doFetch(`${base}${path}`, { signal });
    if (!response.ok) throw new Error(`nuvo-core ${response.status}`);
    return (await response.json()) as T;
  };
  const send = async (method: string, path: string) => {
    await doFetch(`${base}${path}`, { method });
  };
  const tracks = async ({ q, cursor, limit = 100, signal }: { q?: string; cursor?: string; limit?: number; signal?: AbortSignal }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const page = await get<{ items: RawItem[]; nextCursor: string | null; total: number }>(`/v1/local/tracks?${params}`, signal);
    const items = page.items.flatMap((item) => {
      const track = fromSnapshot(item.track);
      return track ? [{ ...item, track, unsupported: item.unsupported ?? null }] : [];
    });
    return { items, nextCursor: page.nextCursor, total: page.total };
  };
  return {
    roots: (signal?: AbortSignal) => get<{ items: LocalRootView[] }>("/v1/local/roots", signal).then((r) => r.items),
    removeRoot: (id: number) => send("DELETE", `/v1/local/roots/${id}`),
    rescan: () => send("POST", "/v1/local/rescan"),
    status: () => get<LocalScanView>("/v1/local/status"),
    tracks,
    /** Every page; a library of 20 000 files is about 40 requests of 500. */
    async allTracks(q?: string, signal?: AbortSignal): Promise<LocalTrackView[]> {
      const all: LocalTrackView[] = [];
      let cursor: string | undefined;
      do {
        const page = await tracks({ q, cursor, limit: PAGE, signal });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
    downloads: () => get<{ items: DownloadView[] }>("/v1/downloads").then((r) => r.items),
    cancelDownload: (id: string) => send("DELETE", `/v1/downloads/${encodeURIComponent(id)}`),
  };
}

export type LocalClient = ReturnType<typeof createLocalClient>;

/** The one status line under the folder chips, most urgent first; null when there is nothing to say. */
export function scanLine(status: LocalScanView | null, roots: readonly LocalRootView[]): { key: string; vars?: Record<string, string | number> } | null {
  if (status?.scanning) return { key: "ui.local.scan_reading", vars: { read: status.read, total: status.total } };
  const missing = roots.filter((root) => root.status === "missing");
  if (missing.length === 1) return { key: "ui.local.scan_missing", vars: { path: missing[0].path } };
  if (missing.length > 1) return { key: "ui.local.scan_missing_many", vars: { count: missing.length } };
  if (roots.length === 0 || !status) return null;
  if (status.truncated) return { key: "ui.local.scan_truncated" };
  if (status.polling) return { key: "ui.local.scan_polling" };
  return { key: "ui.local.scan_watching", vars: { count: status.watching } };
}

export function downloadProgress(jobs: readonly DownloadView[]): { done: number; total: number } | null {
  const running = jobs.filter((job) => job.status === "running");
  if (running.length === 0) return null;
  return { done: running.reduce((sum, job) => sum + job.done + job.failed, 0), total: running.reduce((sum, job) => sum + job.total, 0) };
}
