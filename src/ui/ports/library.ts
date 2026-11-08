import { useEffect, useState } from "react";
import { playerEngine } from "@/engine/compat";
import { kickOfflineFill } from "@/engine/index";
import type { Track } from "@/engine/types";
import { coreRequest } from "@/data/core/request";
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

/** One row of Home's "most saved" shelf, as the daemon counts saves. */
export interface MostSavedEntry {
  type: "album" | "playlist";
  id: string;
  title: string;
  subtitle: string;
  coverUrl?: string | null;
  saves: number;
}

const MOST_SAVED_LIMIT = 20;

/** Saved albums and playlists, the daemon's "most saved" list for Home's shelf; empty when it cannot answer. */
export async function mostSaved(): Promise<MostSavedEntry[]> {
  try {
    return (await coreRequest<{ items: MostSavedEntry[] }>("GET", `/v1/explore/most-saved?type=all&limit=${MOST_SAVED_LIMIT}`)).items;
  } catch {
    return [];
  }
}

/** Sets your playlist's description, or clears it when blank, then refreshes the open page. */
export async function savePlaylistDescription(id: string, description: string): Promise<void> {
  await libraryClient.setDescription(id, description);
  notifyLibraryChanged();
}

export type { PlaylistSort } from "@/data/library/client";

/** Stores your playlist's order in the daemon, which sends the items in it from then on. */
export async function setPlaylistSort(id: string, mode: PlaylistSort): Promise<void> {
  await libraryClient.setSort(id, mode);
  notifyLibraryChanged();
}

/** Keeps your playlist in the audio cache, or lets the cache drop it again. */
export async function keepPlaylistOffline(id: string, on: boolean): Promise<void> {
  await libraryClient.setPinnedOffline(id, on);
  notifyLibraryChanged();
  if (on) kickOfflineFill();
}

const OFFLINE_POLL_MS = 5000;

/** Cached songs of a kept playlist, read again every few seconds until all are in; null while not kept or unknown. */
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

/** Adds a track the app already holds to your playlist, then refreshes the open page. */
export async function addTrackToPlaylist(playlistId: string, track: Track): Promise<void> {
  await libraryClient.addTrack(playlistId, track);
  notifyLibraryChanged();
}

/** What a library entry plays: its id, its kind, and whether it is one of your own playlists. */
export interface PlayableEntry {
  kind: "liked" | "playlist" | "album" | "artist";
  id: string;
  title: string;
  cover: string | null;
  own?: boolean;
}

/** All liked tracks, page by page. */
export const likedTracks = (): Promise<Track[]> => library().liked.allTracks();

async function entryTracks(entry: PlayableEntry): Promise<Track[]> {
  if (entry.kind === "liked") return likedTracks();
  if (entry.kind === "playlist" && entry.own) return (await libraryClient.playlist(entry.id)).tracks;
  return entityTracks(entry.kind as "playlist" | "album" | "artist", entry.id);
}

/** Replaces the queue with the entry's tracks and plays the first under the given playback context. */
export async function playLibraryEntry(entry: PlayableEntry, context: string): Promise<void> {
  const tracks = await entryTracks(entry);
  if (tracks.length === 0) return;
  playerEngine.clearQueue();
  await playerEngine.playTrack(tracks[0], tracks, context, entry.cover);
}
