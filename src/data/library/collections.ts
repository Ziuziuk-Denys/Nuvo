import { createStore } from "zustand/vanilla";
import { CoreError } from "@/imports/core";
import { isArtworkHost, resizeArtwork } from "@/youtube/catalog/map";
import type { LibraryClient, PlaylistSummary, SavedEntry, SavedKind } from "./client";

/** Own playlists and saved albums, artists and playlists. */
export interface LibraryItemViewModel {
  kind: SavedKind;
  type: SavedKind;
  id: string;
  title: string;
  creator?: string;
  imageUrl: string;
  trackCount?: number;
  year?: number;
  href: string;
  addedAt: string;
  owned: false;
  /** Mirrored from an account; it cannot be removed here. */
  source?: "youtube";
}

export interface RemoveTarget {
  id: string;
  type: SavedKind;
  isOwned?: boolean;
}

type Status = "idle" | "loading" | "ready" | "error";
interface SavedSlot {
  items: LibraryItemViewModel[];
  loaded: boolean;
  error?: unknown;
}

const KINDS: SavedKind[] = ["album", "artist", "playlist"];
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function coverOf(snapshot: Record<string, unknown>): string {
  const cover = snapshot.cover as { url?: unknown } | undefined;
  return text(cover?.url) ?? text(snapshot.coverUrl) ?? "";
}

export function toLibraryItem(entry: SavedEntry): LibraryItemViewModel {
  const s = entry.snapshot;
  const artists = Array.isArray(s.artists) ? (s.artists as Array<{ name?: unknown }>).map((a) => text(a.name)).filter(Boolean) : [];
  const image = coverOf(s);
  const base = { kind: entry.kind, type: entry.kind, id: entry.id, addedAt: entry.savedAt, owned: false as const };
  if (entry.kind === "artist") {
    return {
      ...base,
      title: text(s.name) ?? text(s.title) ?? "",
      imageUrl: image && isArtworkHost(image) ? resizeArtwork(image, "=s1200") : image,
      href: `/artist?id=${encodeURIComponent(entry.id)}`,
    };
  }
  return {
    ...base,
    title: text(s.title) ?? "",
    creator: entry.kind === "album" ? artists.join(", ") || undefined : text(s.author),
    imageUrl: image,
    trackCount: num(s.trackCount) ?? num(s.totalTracks),
    year: num(s.year),
    href: `/collection?type=${entry.kind}&id=${encodeURIComponent(entry.id)}`,
  };
}

interface Deps {
  client: LibraryClient;
  onError(error: unknown): void;
  onChange(): void;
}

export function createCollections({ client, onError, onChange }: Deps) {
  const playlists = createStore<{ items: PlaylistSummary[]; status: Status }>(() => ({ items: [], status: "idle" }));
  const empty = (): SavedSlot => ({ items: [], loaded: false });
  const saved = createStore<Record<SavedKind, SavedSlot>>(() => ({ album: empty(), artist: empty(), playlist: empty() }));

  async function readPlaylists(background: boolean): Promise<void> {
    if (!background) playlists.setState({ status: "loading" });
    try {
      playlists.setState({ items: await client.playlists(), status: "ready" });
    } catch (error) {
      if (!background) playlists.setState({ status: "error" });
      onError(error);
    }
  }

  async function readSaved(kind: SavedKind): Promise<void> {
    try {
      const items = (await client.saved(kind)).map(toLibraryItem);
      saved.setState({ [kind]: { items, loaded: true, error: undefined } } as Partial<Record<SavedKind, SavedSlot>>);
    } catch (error) {
      saved.setState({ [kind]: { ...saved.getState()[kind], loaded: true, error } } as Partial<Record<SavedKind, SavedSlot>>);
    }
  }

  const unsaveQuietly = async (kind: SavedKind, id: string) => {
    try {
      await client.unsave(kind, id);
    } catch (error) {
      if (!(error instanceof CoreError && error.status === 404)) throw error;
    }
  };

  const api = {
    playlists,
    saved,
    async load(): Promise<void> {
      await Promise.all([readPlaylists(false), ...KINDS.map(readSaved)]);
    },
    async refresh(): Promise<void> {
      await Promise.all([readPlaylists(true), ...KINDS.map(readSaved)]);
    },
    async deletePlaylist(id: string): Promise<void> {
      const before = playlists.getState().items;
      playlists.setState({ items: before.filter((p) => p.id !== id) });
      try {
        await client.deletePlaylist(id);
        onChange();
      } catch (error) {
        playlists.setState({ items: before });
        onError(error);
        throw error;
      }
    },
    async removeFromLibrary({ id, type, isOwned }: RemoveTarget): Promise<void> {
      if (type !== "playlist" || isOwned === false) return api.unsave(type, id);
      try {
        await api.deletePlaylist(id);
      } catch (error) {
        if (isOwned === undefined && error instanceof CoreError && error.status === 404) return api.unsave(type, id);
        throw error;
      }
      await unsaveQuietly("playlist", id);
    },
    async save(kind: SavedKind, id: string, snapshot: Record<string, unknown>): Promise<void> {
      await client.save(kind, id, snapshot);
      await readSaved(kind);
      onChange();
    },
    async unsave(kind: SavedKind, id: string): Promise<void> {
      const slot = saved.getState()[kind];
      saved.setState({ [kind]: { ...slot, items: slot.items.filter((item) => item.id !== id) } } as Partial<Record<SavedKind, SavedSlot>>);
      try {
        await unsaveQuietly(kind, id);
        onChange();
      } catch (error) {
        saved.setState({ [kind]: slot } as Partial<Record<SavedKind, SavedSlot>>);
        onError(error);
        throw error;
      }
    },
  };
  return api;
}

export type Collections = ReturnType<typeof createCollections>;
