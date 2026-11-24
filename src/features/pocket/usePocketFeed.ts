import { useEffect, useState } from "react";
import { CORE_BASE_URL } from "@/data/core/request";
import { coverUrl } from "@/data/covers/coverUrl";
import type { NotchTrack } from "@/notch/contracts";
import { POCKET_MAX, POCKET_QUEUE_MAX, type PocketFeed, type PocketLook } from "@/pocket/contracts";
import { useLoudnessShape } from "../sound/loudnessShape";
import { useNotchSettingsStore } from "../notch/store/notchSettingsStore";
import { usePocketStore } from "./pocketStore";

export interface PocketTrack {
  id: string;
  title: string;
  artists: string;
  coverUrl: string;
  durationMs: number;
}

const ROW_COVER_PX = 40;
const MAX_TEXT = 256;

function cover(src: string, px: number): string | null {
  const url = coverUrl(CORE_BASE_URL, src, px, 2);
  return url.startsWith("nuvo-core://local/") && url.length <= 2048 ? url : null;
}

function row(track: PocketTrack): NotchTrack {
  return {
    id: track.id,
    title: track.title.slice(0, MAX_TEXT),
    artist: track.artists.slice(0, MAX_TEXT),
    coverUrl: cover(track.coverUrl, ROW_COVER_PX),
    durationMs: Math.max(0, track.durationMs || 0),
  };
}

function readLook(): PocketLook {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return { light: root.dataset.theme === "light", field: style.getPropertyValue("--n-field").trim(), ink: style.getPropertyValue("--n-ink").trim() };
}

export function pocketFeed(current: PocketTrack | null, queue: readonly PocketTrack[], index: number, look: PocketLook, shape: number[] | null): PocketFeed {
  if (!current) return { trackId: null, coverUrl: null, upNext: [], shape: null, look };
  return {
    look,
    shape: shape && shape.length > 1 ? shape : null,
    trackId: current.id,
    coverUrl: cover(current.coverUrl, POCKET_MAX),
    upNext: queue.slice(index + 1, index + 1 + POCKET_QUEUE_MAX).map(row),
  };
}

export function usePocketFeed(current: PocketTrack | null, queue: readonly PocketTrack[], index: number): void {
  const open = usePocketStore((state) => state.open);
  const notch = useNotchSettingsStore((state) => state.mode !== "off");
  const wanted = open || notch;
  const shape = useLoudnessShape(current?.id ?? null, open);
  const [look, setLook] = useState<PocketLook | null>(null);

  useEffect(() => {
    const shell = window.nuvoShell;
    if (!shell) return;
    const setOpen = (open: boolean) => usePocketStore.setState({ open });
    void shell.getPocketStatus().then((status) => status && setOpen(status.open));
    return shell.onPocketOpen(setOpen);
  }, []);

  useEffect(() => {
    if (!wanted) return;
    const read = () => setLook(readLook());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-look"] });
    return () => observer.disconnect();
  }, [wanted]);

  useEffect(() => {
    if (wanted && look) window.nuvoShell?.pocketUpdateFeed(pocketFeed(current, queue, index, look, shape));
  }, [wanted, current, queue, index, shape, look?.light, look?.field, look?.ink]); // eslint-disable-line react-hooks/exhaustive-deps
}
