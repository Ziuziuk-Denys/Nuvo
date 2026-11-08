import { coreRequest } from "@/data/core/request";
import { fromSnapshot, toSnapshot } from "@/engine/snapshot";
import type { Track } from "@/engine/types";

/** Typed calls to the daemon's library routes. */
export type SavedKind = "album" | "artist" | "playlist";

/** The orders the daemon stores per playlist; "manual" is the order you dragged. */
export const PLAYLIST_SORTS = ["manual", "added", "title", "artist", "album", "duration"] as const;
export type PlaylistSort = (typeof PLAYLIST_SORTS)[number];

export const PLAYLIST_TITLE_MAX = 200;
export const PLAYLIST_DESCRIPTION_MAX = 2000;

export interface PlaylistSummary {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  coverUrl: string | null;
  trackCount: number;
  covers: string[];
  sortMode: PlaylistSort;
  /** Kept in the audio cache for offline listening. */
  pinnedOffline: boolean;
}

export interface PlaylistDetail extends Omit<PlaylistSummary, "trackCount" | "covers"> {
  tracks: Track[];
}

export interface SavedEntry {
  kind: SavedKind;
  id: string;
  snapshot: Record<string, unknown>;
  savedAt: string;
}

export interface LikedPage {
  tracks: Track[];
  next: string | null;
}

interface RawPlaylist {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  coverUrl?: string;
  trackCount?: number;
  covers?: string[];
  sortMode?: string;
  pinnedOffline?: boolean;
}

interface RawItem {
  id: string;
  track: unknown;
  position?: number;
  addedAt?: string;
}

/** A playlist item's place, enough to put it back where it was (the daemon's insert route). */
export interface ItemPlace {
  trackId: string;
  position: number;
  addedAt: string;
}

const PLURAL: Record<SavedKind, string> = { album: "albums", artist: "artists", playlist: "playlists" };
const enc = encodeURIComponent;

function summary(raw: RawPlaylist): PlaylistSummary {
  return {
    id: raw.id,
    title: raw.title,
    ...(raw.description ? { description: raw.description } : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    revision: raw.revision,
    coverUrl: raw.coverUrl ?? null,
    trackCount: raw.trackCount ?? 0,
    covers: raw.covers ?? [],
    sortMode: PLAYLIST_SORTS.find((mode) => mode === raw.sortMode) ?? "manual",
    pinnedOffline: raw.pinnedOffline === true,
  };
}

function tracksOf(items: RawItem[]): Track[] {
  const tracks: Track[] = [];
  for (const item of items) {
    const track = fromSnapshot(item.track);
    if (track) tracks.push({ ...track, playlistItemId: item.id });
  }
  return tracks;
}

/** A whole playlist as the daemon gives it back after a merge deleted it; `restore` takes it as it is. */
export type PlaylistSnapshot = Record<string, unknown>;

export interface MergeResult {
  added: number;
  addedItemIds: string[];
  skipped: number;
  deletedSourceIds: string[];
  snapshots: PlaylistSnapshot[];
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

export const libraryClient = {
  async likedPage(limit: number, cursor?: string): Promise<LikedPage> {
    const query = cursor ? `&cursor=${enc(cursor)}` : "";
    const page = await coreRequest<{ items: Array<{ track: unknown }>; nextCursor: string | null }>("GET", `/v1/me/library/tracks?limit=${limit}${query}`);
    const tracks = page.items.map((item) => fromSnapshot(item.track)).filter((track): track is Track => track !== null);
    return { tracks, next: page.nextCursor ?? null };
  },
  async likedIds(): Promise<string[]> {
    return (await coreRequest<{ ids: string[] }>("GET", "/v1/me/library/track-ids")).ids;
  },
  like: (track: Track) => coreRequest<void>("PUT", `/v1/me/library/tracks/${enc(track.id)}`, { track: toSnapshot(track) }),
  unlike: (id: string) => coreRequest<void>("DELETE", `/v1/me/library/tracks/${enc(id)}`),
  async playlists(): Promise<PlaylistSummary[]> {
    return (await coreRequest<{ items: RawPlaylist[] }>("GET", "/v1/me/playlists")).items.map(summary);
  },
  async playlist(id: string): Promise<PlaylistDetail> {
    const raw = await coreRequest<{ playlist: RawPlaylist; items: RawItem[] }>("GET", `/v1/me/playlists/${enc(id)}`);
    const { trackCount: _count, covers: _covers, ...head } = summary(raw.playlist);
    return { ...head, tracks: tracksOf(raw.items) };
  },
  async createPlaylist(title: string, description?: string): Promise<PlaylistSummary> {
    const body = {
      title: title.trim().slice(0, PLAYLIST_TITLE_MAX),
      ...(description?.trim() ? { description: description.trim().slice(0, PLAYLIST_DESCRIPTION_MAX) } : {}),
    };
    return summary(await coreRequest<RawPlaylist>("POST", "/v1/me/playlists", body));
  },
  /** A blank description clears it. */
  setDescription: (id: string, description: string) =>
    coreRequest<void>("PATCH", `/v1/me/playlists/${enc(id)}`, { description: description.trim().slice(0, PLAYLIST_DESCRIPTION_MAX) || null }),
  /** Recently added comes newest first; every other order runs A to Z or short to long. */
  setSort: (id: string, mode: PlaylistSort) => coreRequest<void>("PATCH", `/v1/me/playlists/${enc(id)}`, { sortMode: mode, sortDesc: mode === "added" }),
  /** Tracks of a kept playlist stay in the audio cache; the idle fill brings in the missing ones. */
  setPinnedOffline: (id: string, on: boolean) => coreRequest<void>("PATCH", `/v1/me/playlists/${enc(id)}`, { pinnedOffline: on }),
  /** How many of the playlist's tracks are cached or local. */
  offlineProgress: (id: string) => coreRequest<{ cached: number; total: number }>("GET", `/v1/me/playlists/${enc(id)}/offline`),
  deletePlaylist: (id: string) => coreRequest<void>("DELETE", `/v1/me/playlists/${enc(id)}`),
  addTrack: (playlistId: string, track: Track) =>
    coreRequest<void>("POST", `/v1/me/playlists/${enc(playlistId)}/tracks/${enc(track.id)}`, { track: toSnapshot(track) }),
  /** Item ids with their track, position and date, in playlist order. */
  async playlistItems(id: string): Promise<Array<ItemPlace & { id: string }>> {
    const raw = await coreRequest<{ items: RawItem[] }>("GET", `/v1/me/playlists/${enc(id)}`);
    return raw.items.flatMap((item) => {
      const trackId = (item.track as { id?: unknown } | null)?.id;
      if (typeof trackId !== "string") return [];
      return [{ id: item.id, trackId, position: item.position ?? 0, addedAt: item.addedAt ?? "" }];
    });
  },
  async insertItems(playlistId: string, items: ItemPlace[]): Promise<{ added: number; rejected: number }> {
    const answer = await coreRequest<{ added: number; rejected: number }>("POST", `/v1/me/playlists/${enc(playlistId)}/items/insert`, { items });
    return { added: answer.added, rejected: answer.rejected };
  },
  /** Copies or moves items into another playlist; the new items' ids come back for Undo. */
  async transferItems(playlistId: string, itemIds: string[], targetId: string, mode: "copy" | "move"): Promise<{ addedIds: string[]; skipped: number }> {
    const answer = await coreRequest<{ added: Array<{ id: string }>; skipped: number }>("POST", `/v1/me/playlists/${enc(playlistId)}/items/transfer`, {
      itemIds,
      targetId,
      mode,
    });
    return { addedIds: answer.added.map((item) => item.id), skipped: answer.skipped };
  },
  /** Adds the sources' songs to the target, skipping songs it has; `deleteSources` removes them and hands back their snapshots. */
  merge: (targetId: string, sourceIds: string[], deleteSources: boolean) =>
    coreRequest<MergeResult>("POST", `/v1/me/playlists/${enc(targetId)}/merge`, { sourceIds, skipDuplicates: true, deleteSources }),
  /** The whole playlist as `restore` takes it: fields, item places and the custom cover's bytes. */
  async snapshot(id: string): Promise<PlaylistSnapshot> {
    const raw = await coreRequest<{ playlist: Record<string, unknown>; items: RawItem[] }>("GET", `/v1/me/playlists/${enc(id)}`);
    const { coverUrl, ownerId: _owner, updatedAt: _updated, ...head } = raw.playlist;
    const items = raw.items.flatMap((item) => {
      const trackId = (item.track as { id?: unknown } | null)?.id;
      return typeof trackId === "string" ? [{ trackId, position: item.position ?? 0, addedAt: item.addedAt ?? "" }] : [];
    });
    let cover: { mime: string; base64: string } | undefined;
    // an unreadable cover never blocks the delete; the playlist comes back without it
    if (typeof coverUrl === "string") {
      const blob = await fetch(coverUrl)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null);
      if (blob) cover = { mime: blob.type.split(";")[0], base64: base64(new Uint8Array(await blob.arrayBuffer())) };
    }
    return { ...head, items, ...(cover ? { cover } : {}) };
  },
  /** Brings deleted playlists back from their snapshots, with their ids, items and covers. */
  restore: (snapshots: PlaylistSnapshot[]) => coreRequest<unknown>("POST", "/v1/me/playlists/restore", { snapshots }).then(() => undefined),
  setCover: (playlistId: string, image: Blob) => coreRequest<unknown>("PUT", `/v1/me/playlists/${enc(playlistId)}/cover`, image).then(() => undefined),
  removeCover: (playlistId: string) => coreRequest<void>("DELETE", `/v1/me/playlists/${enc(playlistId)}/cover`),
  removeItems: (playlistId: string, itemIds: string[]) => coreRequest<void>("POST", `/v1/me/playlists/${enc(playlistId)}/items/remove`, { itemIds }),
  async moveItem(playlistId: string, itemId: string, beforeItemId: string | null, revision: number): Promise<{ revision: number }> {
    const answer = await coreRequest<{ playlist: RawPlaylist }>("POST", `/v1/me/playlists/${enc(playlistId)}/items/${enc(itemId)}/move`, {
      beforeItemId,
      revision,
    });
    return { revision: answer.playlist.revision };
  },
  async saved(kind: SavedKind): Promise<SavedEntry[]> {
    const answer = await coreRequest<{ items: Array<Record<string, unknown>> }>("GET", `/v1/me/library/${PLURAL[kind]}`);
    return answer.items.flatMap((item) => {
      const snapshot = item[kind] as Record<string, unknown> | undefined;
      if (!snapshot || typeof snapshot.id !== "string") return [];
      return [{ kind, id: snapshot.id, snapshot, savedAt: String(item.savedAt ?? "") }];
    });
  },
  save: (kind: SavedKind, id: string, snapshot: Record<string, unknown>) => coreRequest<void>("PUT", `/v1/me/library/${PLURAL[kind]}/${enc(id)}`, { snapshot }),
  unsave: (kind: SavedKind, id: string) => coreRequest<void>("DELETE", `/v1/me/library/${PLURAL[kind]}/${enc(id)}`),
};

export type LibraryClient = typeof libraryClient;
