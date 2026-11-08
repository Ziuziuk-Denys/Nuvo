import { create } from "zustand";
import { libraryClient, type PlaylistSnapshot } from "./client";
import { notifyLibraryChanged } from "./changes";

export interface DeletedPlaylist {
  id: string;
  title: string;
  trackCount: number;
  deletedAt: number;
  snapshot: PlaylistSnapshot;
}

const KEEP = 20;

/**
 * Your playlists deleted in this session, newest first, each with what `restore` needs.
 * shortcut: kept in memory only, so the encrypted library's contents never reach browser storage; a trash in the daemon would keep them across restarts.
 */
export const useRecentlyDeleted = create<{ items: DeletedPlaylist[] }>(() => ({ items: [] }));

/** Snapshots your playlist, deletes it through `remove`, and keeps the snapshot for Undo and Recently deleted. */
export async function deleteKeepingSnapshot(id: string, remove: () => Promise<void>): Promise<DeletedPlaylist> {
  const snapshot = await libraryClient.snapshot(id);
  await remove();
  const entry: DeletedPlaylist = {
    id,
    title: typeof snapshot.title === "string" ? snapshot.title : "",
    trackCount: Array.isArray(snapshot.items) ? snapshot.items.length : 0,
    deletedAt: Date.now(),
    snapshot,
  };
  useRecentlyDeleted.setState((state) => ({ items: [entry, ...state.items.filter((item) => item.id !== id)].slice(0, KEEP) }));
  return entry;
}

/** Brings a deleted playlist back with its id, songs in place and cover. */
export async function restoreDeleted(id: string): Promise<void> {
  const entry = useRecentlyDeleted.getState().items.find((item) => item.id === id);
  if (!entry) return;
  await libraryClient.restore([entry.snapshot]);
  useRecentlyDeleted.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  notifyLibraryChanged();
}
