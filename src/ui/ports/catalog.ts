import { useEffect, useState } from "react";
import { artistTopTrack } from "@/data/catalog/pages";
import { hasCachedAudio } from "@/data/storage/storage";
import { playerEngine } from "@/engine/compat";
import type { Track } from "@/engine/types";

export {
  useArtist,
  useCollection,
  type ArtistPageData,
  type CollectionPageData,
  type ArtistRelease as ArtistAlbumViewModel,
  type ArtistRelease as ArtistReleaseViewModel,
} from "@/data/catalog/pages";

/** Parallel lookups against the daemon; more would queue behind the per-host connection limit and time out. */
const LOOKUPS = 6;

// The cache has no list call, so each id is probed with a one-byte range read
export function useCachedTrackIds(trackIds: readonly string[], enabled = true): Set<string> | null {
  const [cached, setCached] = useState<Set<string> | null>(null);
  const key = enabled ? trackIds.filter(Boolean).join("\n") : null;

  useEffect(() => {
    setCached(null);
    if (key === null) return;
    let active = true;
    const pending = key ? key.split("\n") : [];
    const found = new Set<string>();
    const worker = async () => {
      while (active && pending.length > 0) {
        const id = pending.shift()!;
        if (await hasCachedAudio(id)) found.add(id);
      }
    };
    void Promise.all(Array.from({ length: LOOKUPS }, worker)).then(() => {
      if (active) setCached(found);
    });
    return () => {
      active = false;
    };
  }, [key]);

  return cached;
}

export async function startArtistRadio(artistId: string, seed?: Track): Promise<void> {
  const track = seed ?? (await artistTopTrack(artistId));
  if (track) await playerEngine.startRadioStation(track);
}
