import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Track } from "@/engine/types";
import { library } from "./library";
import { libraryClient, type PlaylistDetail, type PlaylistSummary, type SavedKind } from "./client";
import type { LibraryItemViewModel, RemoveTarget } from "./collections";
import { notifyLibraryChanged, onLibraryChange } from "./changes";

/** The library names the screens use (src/ui/ports/library.ts), over the library modules. */
export type EntityType = SavedKind;
/** A playlist as the screens list it: a cover string always, and the collage covers by their old name. */
export type LibraryPlaylistSummary = Omit<PlaylistSummary, "coverUrl" | "covers"> & { coverUrl: string; coverUrls: string[] };
export type LibraryPlaylistDetail = PlaylistDetail;
export type LibrarySortOption = "recent" | "title" | "creator";
export type LibraryViewMode = "grid" | "list";
export type { LibraryItemViewModel };
export { notifyLibraryChanged };

export interface MutateOptions<R> {
  onSuccess?(result: R): void;
  onError?(error: unknown): void;
  onSettled?(): void;
}

export interface Mutation<I, R> {
  mutate(input: I, options?: MutateOptions<R>): void;
  mutateAsync(input: I): Promise<R>;
  isPending: boolean;
}

function useMutation<I, R>(run: (input: I) => Promise<R>): Mutation<I, R> {
  const [pending, setPending] = useState(0);
  const mutateAsync = useCallback(
    async (input: I) => {
      setPending((n) => n + 1);
      try {
        return await run(input);
      } finally {
        setPending((n) => n - 1);
      }
    },
    [run],
  );
  const mutate = useCallback(
    (input: I, options?: MutateOptions<R>) => {
      mutateAsync(input)
        .then(
          (result) => options?.onSuccess?.(result),
          (error) => options?.onError?.(error),
        )
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync],
  );
  return { mutate, mutateAsync, isPending: pending > 0 };
}

/** A screen that opens while a read failed (the daemon was still starting) asks for a fresh read. */
function useReadAgainIfFailed(): void {
  useEffect(() => {
    const { liked, collections } = library();
    const failed =
      liked.store.getState().status === "error" ||
      collections.playlists.getState().status === "error" ||
      Object.values(collections.saved.getState()).some((slot) => slot.error !== undefined);
    if (failed) notifyLibraryChanged();
  }, []);
}

export function usePlaylistsList() {
  useReadAgainIfFailed();
  const { items, status } = useStore(library().collections.playlists);
  const playlists = useMemo<LibraryPlaylistSummary[]>(
    () => items.map(({ coverUrl, covers, ...rest }) => ({ ...rest, coverUrl: coverUrl ?? "", coverUrls: covers })),
    [items],
  );
  return {
    data: { playlists },
    isLoading: status === "loading" || status === "idle",
    isFetched: status === "ready" || status === "error",
    error: status === "error" ? new Error("playlists") : undefined,
  };
}

export function usePlaylist(id: string | null) {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [isLoading, setLoading] = useState(id !== null);
  const covers = useStore(library().collections.playlists, (s) => s.items.find((p) => p.id === id)?.covers);
  useEffect(() => {
    if (id === null) {
      setDetail(null);
      setLoading(false);
      return;
    }
    let live = true;
    const read = () =>
      libraryClient
        .playlist(id)
        .then(
          (next) => live && setDetail(next),
          () => live && setDetail(null),
        )
        .finally(() => live && setLoading(false));
    setLoading(true);
    void read();
    const stop = onLibraryChange(() => void read());
    return () => {
      live = false;
      stop();
    };
  }, [id]);
  return { data: detail ? { ...detail, coverUrls: covers ?? [] } : null, isLoading };
}

export function useLikedTracks() {
  useReadAgainIfFailed();
  const { tracks, status } = useStore(library().liked.store);
  return { data: { tracks: tracks as Track[] }, isLoading: status === "loading" || status === "idle", loadMore: () => void library().liked.loadMore() };
}

export function useLikedTrackCount() {
  useReadAgainIfFailed();
  const { ids, status } = useStore(library().liked.store);
  return { data: status === "ready" ? ids.size : undefined, isLoading: status === "idle" || status === "loading" };
}

export function useIsTrackLiked(id?: string): boolean {
  return useStore(library().liked.store, (s) => (id ? s.ids.has(id) : false));
}

export const useLikeTrack = () => useMutation((track: Track) => library().liked.like(track));
export const useUnlikeTrack = () => useMutation((id: string) => library().liked.unlike(id));
export const useAddPlaylistTracks = () =>
  useMutation(async ({ playlistId, track }: { playlistId: string; track: Track }) => {
    await libraryClient.addTrack(playlistId, track);
    notifyLibraryChanged();
  });
export const useCreatePlaylist = () =>
  useMutation(async ({ title, description }: { title: string; description?: string }) => {
    const created = await libraryClient.createPlaylist(title, description);
    notifyLibraryChanged();
    return { id: created.id };
  });
export const useDeletePlaylist = () => useMutation((id: string) => library().collections.deletePlaylist(id));
export const useSaveExternalItem = () =>
  useMutation(({ type, id, snapshot }: { type: SavedKind; id: string; snapshot: Record<string, unknown> }) => library().collections.save(type, id, snapshot));
export const useRemoveExternalItem = () => useMutation((target: RemoveTarget) => library().collections.removeFromLibrary(target));
export const useReorderPlaylistTracks = () =>
  useMutation(async ({ playlistId, itemId, beforeItemId, revision }: { playlistId: string; itemId: string; beforeItemId: string | null; revision: number }) => {
    const result = await libraryClient.moveItem(playlistId, itemId, beforeItemId, revision);
    return { playlist: { revision: result.revision } };
  });
export const useRemovePlaylistTracks = () =>
  useMutation(async ({ playlistId, itemIds }: { playlistId: string; itemIds: string[] }) => {
    await libraryClient.removeItems(playlistId, itemIds);
    notifyLibraryChanged();
  });

export function useExternalItems(kind: SavedKind) {
  useReadAgainIfFailed();
  const slot = useStore(library().collections.saved, (s) => s[kind]);
  return { data: slot.items, loaded: slot.loaded, error: slot.error };
}

export function useYoutubeLibraryItems(): LibraryItemViewModel[] {
  return useStore(library().shelf.store, (s) => s.items);
}
