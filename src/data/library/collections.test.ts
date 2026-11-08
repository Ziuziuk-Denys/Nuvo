import { describe, expect, it, vi } from "vitest";
import { CoreError } from "@/imports/core";
import type { LibraryClient } from "./client";
import { createCollections, toLibraryItem } from "./collections";

const playlist = (id: string) => ({ id, title: id, createdAt: "1", updatedAt: "2", revision: 1, coverUrl: null, trackCount: 6, covers: ["A", "B", "C", "D"] });

function setup(overrides: Partial<LibraryClient> = {}) {
  const client = {
    playlists: vi.fn(async () => Array.from({ length: 40 }, (_, i) => playlist(`p${i}`))),
    saved: vi.fn(async () => []),
    deletePlaylist: vi.fn(async () => undefined),
    unsave: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as LibraryClient;
  const onError = vi.fn();
  return { collections: createCollections({ client, onError, onChange: vi.fn() }), client, onError };
}

describe("saved rows (3.9)", () => {
  it("30: an album keeps its year and count; an artist gets the largest avatar", () => {
    const album = toLibraryItem({
      kind: "album",
      id: "al",
      snapshot: { id: "al", title: "Disc", year: 2019, trackCount: 12, artists: [{ id: "a", name: "Ann" }], cover: { url: "c.jpg" } },
      savedAt: "2026-01-02",
    });
    expect(album).toMatchObject({
      kind: "album",
      type: "album",
      title: "Disc",
      creator: "Ann",
      year: 2019,
      trackCount: 12,
      imageUrl: "c.jpg",
      href: "/collection?type=album&id=al",
      addedAt: "2026-01-02",
      owned: false,
    });
    const artist = toLibraryItem({
      kind: "artist",
      id: "ar",
      snapshot: { id: "ar", name: "Ann", cover: { url: "https://yt3.ggpht.com/x=s88-c-k" } },
      savedAt: "",
    });
    expect(artist).toMatchObject({ title: "Ann", imageUrl: "https://yt3.ggpht.com/x=s1200", href: "/artist?id=ar" });
    const list = toLibraryItem({ kind: "playlist", id: "pl", snapshot: { id: "pl", title: "Mix", author: "Bo" }, savedAt: "" });
    expect(list.creator).toBe("Bo");
  });
});

describe("collections", () => {
  it("28 and 29: one request for 40 playlists, covers as the daemon gave them", async () => {
    const { collections, client } = setup();
    await collections.load();
    expect(client.playlists).toHaveBeenCalledTimes(1);
    expect(collections.playlists.getState().items).toHaveLength(40);
    expect(collections.playlists.getState().items[0].covers).toEqual(["A", "B", "C", "D"]);
  });

  it("deleting a playlist removes it at once and rolls back on failure", async () => {
    const { collections, client } = setup({
      deletePlaylist: vi.fn(async () => {
        throw new CoreError(423, "LOCKED");
      }),
    } as Partial<LibraryClient>);
    await collections.load();
    const pending = collections.deletePlaylist("p1");
    expect(collections.playlists.getState().items.some((p) => p.id === "p1")).toBe(false);
    await expect(pending).rejects.toBeInstanceOf(CoreError);
    expect(collections.playlists.getState().items.some((p) => p.id === "p1")).toBe(true);
    expect(client.deletePlaylist).toHaveBeenCalledWith("p1");
  });

  it("31: an own playlist is deleted and its saved reference removed; someone else's only unsaved", async () => {
    const { collections, client } = setup();
    await collections.load();
    await collections.removeFromLibrary({ id: "p2", type: "playlist", isOwned: true });
    expect(client.deletePlaylist).toHaveBeenCalledWith("p2");
    expect(client.unsave).toHaveBeenCalledWith("playlist", "p2");
    await collections.removeFromLibrary({ id: "x", type: "playlist", isOwned: false });
    expect(client.deletePlaylist).toHaveBeenCalledTimes(1);
    expect(client.unsave).toHaveBeenLastCalledWith("playlist", "x");
  });

  it("31: unknown ownership tries delete and falls back to unsave", async () => {
    const { collections, client } = setup({
      deletePlaylist: vi.fn(async () => {
        throw new CoreError(404, "NOT_FOUND");
      }),
    } as Partial<LibraryClient>);
    await collections.removeFromLibrary({ id: "y", type: "playlist" });
    expect(client.unsave).toHaveBeenCalledWith("playlist", "y");
  });

  it("a failed saved read is an error for that kind only", async () => {
    const { collections } = setup({
      saved: vi.fn(async (kind: string) => {
        if (kind === "artist") throw new CoreError(0, "CORE_DOWN");
        return [];
      }),
    } as Partial<LibraryClient>);
    await collections.load();
    const saved = collections.saved.getState();
    expect(saved.artist.error).toBeInstanceOf(CoreError);
    expect(saved.album).toMatchObject({ loaded: true, error: undefined });
  });
});
