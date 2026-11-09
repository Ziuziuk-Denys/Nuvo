import { useCallback, useEffect, useMemo, useState } from "react";
import { filterTracks } from "@/data/search/trackMatch";
import { CORE_BASE_URL } from "@/engine/boot";
import { isLocalId } from "@/engine/types";
import { createLocalClient, scanLine, type LocalRootView, type LocalScanView, type LocalTrackView } from "@/local/client";
import type { Track } from "./player";

export type { LocalRootView, LocalScanView, LocalTrackView };
export { scanLine };

const client = createLocalClient(CORE_BASE_URL);
const SCAN_POLL_MS = 500;
const changed = new Set<() => void>();

function notifyLocalChanged(): void {
  changed.forEach((listener) => listener());
}

function useReload(): [number, () => void] {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    changed.add(reload);
    return () => void changed.delete(reload);
  }, [reload]);
  return [tick, reload];
}

export function isLocalTrackId(id: string): boolean {
  return isLocalId(id);
}

export function toPlayerTrack(view: LocalTrackView): Track {
  return { ...view.track, playCount: view.track.playCount ?? 0 } as Track;
}

export function useLocalRoots(): { roots: LocalRootView[]; failed: boolean; reload(): void } {
  const [tick, reload] = useReload();
  const [roots, setRoots] = useState<LocalRootView[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    client.roots(controller.signal).then(
      (next) => {
        setRoots(next);
        setFailed(false);
      },
      () => !controller.signal.aborted && setFailed(true),
    );
    return () => controller.abort();
  }, [tick]);
  return { roots, failed, reload };
}

export function useLocalScan(): LocalScanView | null {
  const [tick] = useReload();
  const [status, setStatus] = useState<LocalScanView | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasScanning = false;
    const read = () =>
      client.status().then(
        (next) => {
          if (!live) return;
          setStatus(next);
          if (next.scanning) timer = setTimeout(read, SCAN_POLL_MS);
          else if (wasScanning) notifyLocalChanged();
          wasScanning = next.scanning;
        },
        () => undefined,
      );
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tick]);
  return status;
}

export function useLocalTracks(query: string, limit?: number): { items: LocalTrackView[]; loading: boolean; failed: boolean; reload(): void } {
  const [tick, reload] = useReload();
  const [loaded, setLoaded] = useState<LocalTrackView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const asked = limit ? query : "";
  useEffect(() => {
    if (limit && !asked) {
      setLoaded([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const load = limit ? client.tracks({ q: asked, limit, signal: controller.signal }).then((page) => page.items) : client.allTracks("", controller.signal);
    load
      .then(
        (next) => {
          setLoaded(next);
          setFailed(false);
        },
        () => {
          if (controller.signal.aborted) return;
          setLoaded([]);
          setFailed(true);
        },
      )
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [asked, limit, tick]);
  const items = useMemo(() => {
    if (limit || !query) return loaded;
    const tracks = loaded.map((view) => view.track);
    return filterTracks(tracks, query).map((match) => loaded[match.index]);
  }, [loaded, query, limit]);
  return { items, loading, failed, reload };
}

export async function addMusicFolder(): Promise<string | null> {
  const result = await window.nuvoShell?.addMusicFolder();
  if (result && "error" in result) return result.error;
  if (result) setTimeout(notifyLocalChanged, SCAN_POLL_MS);
  return null;
}

export async function removeMusicFolder(id: number): Promise<void> {
  await client.removeRoot(id);
  notifyLocalChanged();
}

export async function rescanMusicFolders(): Promise<void> {
  await client.rescan();
  notifyLocalChanged();
}

export function revealLocalTrack(trackId: string): void {
  void window.nuvoShell?.revealLocalTrack(trackId);
}
