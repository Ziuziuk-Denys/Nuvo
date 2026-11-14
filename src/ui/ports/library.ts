import { useEffect, useState } from "react";
import { playerEngine } from "@/engine/compat";
import { kickOfflineFill } from "@/engine/index";
import type { Track } from "@/engine/types";
import { entityTracks } from "@/data/catalog/pages";
import { libraryClient, type PlaylistSort } from "@/data/library/client";
import { library } from "@/data/library/library";
import { notifyLibraryChanged } from "@/data/library/changes";

export {
  usePlaylistsList,
  notifyLibraryChanged,
  usePlaylist,
  useLikedTracks,
  useLikedTrackCount,
  useIsTrackLiked,
  useLikeTrack,
  useUnlikeTrack,
  useAddPlaylistTracks,
  useCreatePlaylist,
  useDeletePlaylist,
  useSaveExternalItem,
  useRemoveExternalItem,
  useReorderPlaylistTracks,
  useRemovePlaylistTracks,
  useExternalItems,
  useYoutubeLibraryItems,
  type EntityType,
  type LibraryPlaylistSummary,
  type LibraryPlaylistDetail,
  type LibraryItemViewModel,
  type LibrarySortOption,
  type LibraryViewMode,
} from "@/data/library/hooks";
export { useLikesCover } from "@/data/library/likesCover";
export { clearTrim, MIN_TRIM_MS, saveTrim, useTrims, type TrackTrim } from "@/data/library/trims";
export { deleteKeepingSnapshot, restoreDeleted, useRecentlyDeleted, type DeletedPlaylist } from "@/data/library/trash";
export { useListReorder } from "@/ui/components/useListReorder";
export { useModalStore } from "@/ui/shell/sheets";
export { livePins, useHomePinsStore, useRailPinsStore, type HomePin, type HomePinKind } from "@/data/library/pins";
export { CoreError as ApiError } from "@/imports/core";

export async function savePlaylistDescription(id: string, description: string): Promise<void> {
  await libraryClient.setDescription(id, description);
  notifyLibraryChanged();
}

export type { PlaylistSort } from "@/data/library/client";

export async function setPlaylistSort(id: string, mode: PlaylistSort): Promise<void> {
  await libraryClient.setSort(id, mode);
  notifyLibraryChanged();
}

export async function keepPlaylistOffline(id: string, on: boolean): Promise<void> {
  await libraryClient.setPinnedOffline(id, on);
  notifyLibraryChanged();
  if (on) kickOfflineFill();
}

const OFFLINE_POLL_MS = 5000;

export function useOfflineProgress(id: string | null, kept: boolean): { cached: number; total: number } | null {
  const [progress, setProgress] = useState<{ cached: number; total: number } | null>(null);
  useEffect(() => {
    setProgress(null);
    if (!id || !kept) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () =>
      libraryClient.offlineProgress(id).then(
        (next) => {
          if (!live) return;
          setProgress(next);
          if (next.cached < next.total) timer = setTimeout(read, OFFLINE_POLL_MS);
        },
        () => undefined,
      );
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, kept]);
  return progress;
}

export async function addTrackToPlaylist(playlistId: string, track: Track): Promise<void> {
  await libraryClient.addTrack(playlistId, track);
  notifyLibraryChanged();
}

export interface PlayableEntry {
  kind: "liked" | "playlist" | "album" | "artist";
  id: string;
  title: string;
  cover: string | null;
  own?: boolean;
}

export const likedTracks = (): Promise<Track[]> => library().liked.allTracks();

async function entryTracks(entry: PlayableEntry): Promise<Track[]> {
  if (entry.kind === "liked") return likedTracks();
  if (entry.kind === "playlist" && entry.own) return (await libraryClient.playlist(entry.id)).tracks;
  return entityTracks(entry.kind as "playlist" | "album" | "artist", entry.id);
}

export async function playLibraryEntry(entry: PlayableEntry, context: string): Promise<void> {
  const tracks = await entryTracks(entry);
  if (tracks.length === 0) return;
  playerEngine.clearQueue();
  await playerEngine.playTrack(tracks[0], tracks, context, entry.cover);
}
