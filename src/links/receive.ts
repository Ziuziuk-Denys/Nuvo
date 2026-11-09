import type { ImportSummary } from "./core";
import { shareImportRows } from "./share";
import type { Share } from "./shareCodec";
import type { CatalogTrack, ImportRow, ImportTarget } from "./types";

export const PREVIEW_ROWS = 12;
const LOOKUPS_AT_ONCE = 4;

export interface ReceivePorts {
  youtubeTrack(id: string, signal: AbortSignal): Promise<CatalogTrack | null>;
  soundcloudTrack(id: string, signal: AbortSignal): Promise<CatalogTrack | null>;
}

export interface ImportPorts extends ReceivePorts {
  startImport(
    body: {
      source: "nuvo-link";
      label: string;
      rows: ImportRow[];
      target?: ImportTarget;
    },
    signal: AbortSignal,
  ): Promise<{ items: ImportSummary[] }>;
}

export interface PreviewRow {
  index: number;
  title: string;
  artist: string;
  durationMs?: number;
  missing: boolean;
}

function needsLookup(share: Share, index: number): boolean {
  const track = share.tracks[index];
  return track.source !== "text" && track.title === undefined;
}

export async function lookupNames(share: Share, indexes: number[], ports: ReceivePorts, signal: AbortSignal): Promise<Map<number, CatalogTrack>> {
  const queue = indexes.filter((index) => needsLookup(share, index));
  const found = new Map<number, CatalogTrack>();
  const worker = async () => {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      signal.throwIfAborted();
      const track = share.tracks[index];
      const snapshot = await (
        track.source === "youtube" ? ports.youtubeTrack(track.id as string, signal) : ports.soundcloudTrack(`sc:${track.id}`, signal)
      ).catch((error: unknown) => {
        if (signal.aborted) throw error;
        return null;
      });
      if (snapshot) found.set(index, snapshot);
    }
  };
  await Promise.all(Array.from({ length: LOOKUPS_AT_ONCE }, worker));
  return found;
}

export function previewRows(share: Share, looked: ReadonlyMap<number, CatalogTrack>, limit = PREVIEW_ROWS): PreviewRow[] {
  return share.tracks.slice(0, limit).map((track, index) => {
    const snapshot = looked.get(index);
    const durationMs = track.durationSec ? track.durationSec * 1000 : snapshot?.durationMs || undefined;
    if (track.title !== undefined)
      return {
        index,
        title: track.title,
        artist: track.artist ?? "",
        durationMs,
        missing: false,
      };
    if (snapshot)
      return {
        index,
        title: snapshot.title,
        artist: snapshot.artists.map((artist) => artist.name).join(", "),
        durationMs,
        missing: false,
      };
    return { index, title: "", artist: "", durationMs, missing: true };
  });
}

let running: Promise<{ summary: ImportSummary | null; unreadable: number }> | null = null;

export function importShare(
  share: Share,
  target: ImportTarget,
  fallbackLabel: string,
  ports: ImportPorts,
  signal: AbortSignal,
): Promise<{ summary: ImportSummary | null; unreadable: number }> {
  running ??= startShareImport(share, target, fallbackLabel, ports, signal).finally(() => {
    running = null;
  });
  return running;
}

async function startShareImport(
  share: Share,
  target: ImportTarget,
  fallbackLabel: string,
  ports: ImportPorts,
  signal: AbortSignal,
): Promise<{ summary: ImportSummary | null; unreadable: number }> {
  const looked = await lookupNames(
    share,
    share.tracks.map((_, index) => index),
    ports,
    signal,
  );
  const { rows, unreadable } = shareImportRows(share, looked);
  if (rows.length === 0) return { summary: null, unreadable };
  const answer = await ports.startImport({ source: "nuvo-link", label: share.title || fallbackLabel, rows, target }, signal);
  return { summary: answer.items[0] ?? null, unreadable };
}
