import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    playlistItems: vi.fn(async () => [
      { id: "i1", trackId: "t1", position: 1, addedAt: "2026-01-01T00:00:00Z" },
      { id: "i2", trackId: "t2", position: 2, addedAt: "2026-01-02T00:00:00Z" },
    ]),
    removeItems: vi.fn(async () => undefined),
    insertItems: vi.fn(async (..._args: unknown[]) => ({ added: 1, rejected: 0 })),
    setCover: vi.fn(async () => undefined),
    removeCover: vi.fn(async () => undefined),
    transferItems: vi.fn(async (..._args: unknown[]) => ({ addedIds: ["n2"], skipped: 0 })),
    merge: vi.fn(async (..._args: unknown[]) => ({ added: 2, addedItemIds: ["n1", "n2"], skipped: 0, deletedSourceIds: ["p"], snapshots: [{ id: "p" }] })),
    restore: vi.fn(async (..._args: unknown[]) => undefined),
  },
  show: vi.fn(),
  changed: vi.fn(),
}));
vi.mock("@/data/library/client", () => ({ libraryClient: mocks.client }));
vi.mock("@/ui/feedback/toastStore", () => ({ useToastStore: { getState: () => ({ show: mocks.show }) } }));
vi.mock("@/data/library/changes", () => ({ notifyLibraryChanged: mocks.changed }));

import { MAX_COVER_BYTES, mergeWithUndo, moveWithUndo, pickPlaylistCover, removeWithUndo, setPlaylistCover, squareCrop, UNDO_MS } from "./playlistTools";

const TEXTS = { removed: "Removed", undo: "Undo", undoFailed: "Undo failed", undoPartial: "Partly restored", failed: "Failed" };
const undoAction = () => (mocks.show.mock.calls[0][0] as { action: { onClick(): void } }).action;

beforeEach(() => vi.clearAllMocks());

describe("moveWithUndo and mergeWithUndo", () => {
  const texts = { done: "Moved", undo: "Undo", undoFailed: "Undo failed", failed: "Failed" };

  it("moves the selection, and Undo takes the copies out and puts the items back in place", async () => {
    await moveWithUndo("p", ["i2"], "q", texts);
    expect(mocks.client.transferItems).toHaveBeenCalledWith("p", ["i2"], "q", "move");
    expect(mocks.show.mock.calls[0][0]).toMatchObject({ message: "Moved", action: { label: "Undo" } });
    undoAction().onClick();
    await vi.waitFor(() => expect(mocks.client.insertItems).toHaveBeenCalledWith("p", [{ trackId: "t2", position: 2, addedAt: "2026-01-02T00:00:00Z" }]));
    expect(mocks.client.removeItems).toHaveBeenCalledWith("q", ["n2"]);
  });

  it("merges into the target, and Undo removes the added songs and restores the deleted playlist", async () => {
    expect(await mergeWithUndo("p", "q", true, { ...texts, done: (added) => `Added ${added}` })).toBe(true);
    expect(mocks.client.merge).toHaveBeenCalledWith("q", ["p"], true);
    expect(mocks.show.mock.calls[0][0]).toMatchObject({ message: "Added 2" });
    undoAction().onClick();
    await vi.waitFor(() => expect(mocks.client.restore).toHaveBeenCalledWith([{ id: "p" }]));
    expect(mocks.client.removeItems).toHaveBeenCalledWith("q", ["n1", "n2"]);
  });

  it("says when a merge fails", async () => {
    mocks.client.merge.mockRejectedValueOnce(new Error("404"));
    expect(await mergeWithUndo("p", "q", false, { ...texts, done: () => "" })).toBe(false);
    expect(mocks.show).toHaveBeenCalledWith({ message: "Failed", variant: "error" });
  });
});

describe("removeWithUndo", () => {
  it("removes in one call and offers Undo for 8 s", async () => {
    await removeWithUndo("p", ["i2"], TEXTS);
    expect(mocks.client.removeItems).toHaveBeenCalledWith("p", ["i2"]);
    expect(mocks.changed).toHaveBeenCalled();
    expect(mocks.show.mock.calls[0][0]).toMatchObject({ message: "Removed", duration: UNDO_MS, action: { label: "Undo" } });
  });

  it("Undo puts the items back at their own positions and dates", async () => {
    await removeWithUndo("p", ["i2"], TEXTS);
    undoAction().onClick();
    await vi.waitFor(() => expect(mocks.client.insertItems).toHaveBeenCalledWith("p", [{ trackId: "t2", position: 2, addedAt: "2026-01-02T00:00:00Z" }]));
  });

  it("a failed Undo says so instead of losing the items silently", async () => {
    mocks.client.insertItems.mockRejectedValueOnce(new Error("409"));
    await removeWithUndo("p", ["i2"], TEXTS);
    undoAction().onClick();
    await vi.waitFor(() => expect(mocks.show).toHaveBeenLastCalledWith({ message: "Undo failed", variant: "error" }));
  });

  it("tells the user when some items could not be restored", async () => {
    mocks.client.insertItems.mockResolvedValueOnce({ added: 1, rejected: 1 });
    await removeWithUndo("p", ["i1", "i2"], TEXTS);
    undoAction().onClick();
    await vi.waitFor(() => expect(mocks.show).toHaveBeenLastCalledWith({ message: "Partly restored", variant: "error" }));
    expect(mocks.changed).toHaveBeenCalledTimes(2);
  });

  it("a full restore stays quiet", async () => {
    await removeWithUndo("p", ["i2"], TEXTS);
    undoAction().onClick();
    await vi.waitFor(() => expect(mocks.client.insertItems).toHaveBeenCalled());
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty selection", async () => {
    await removeWithUndo("p", [], TEXTS);
    expect(mocks.client.playlistItems).not.toHaveBeenCalled();
  });
});

describe("covers", () => {
  it("crops the centred square", () => {
    expect(squareCrop(1200, 800)).toEqual({ x: 200, y: 0, size: 800 });
    expect(squareCrop(500, 900)).toEqual({ x: 0, y: 200, size: 500 });
  });

  it("uploads the encoded square", async () => {
    const image = new Blob([new Uint8Array(1000)], { type: "image/webp" });
    expect(await setPlaylistCover("p", new Blob(), "Too large", async () => image)).toBe(true);
    expect(mocks.client.setCover).toHaveBeenCalledWith("p", image);
  });

  it("tries a lower quality, then refuses with a toast when still too large", async () => {
    const encode = vi.fn(async (_file: Blob, _quality: number) => new Blob([new Uint8Array(MAX_COVER_BYTES + 1)], { type: "image/webp" }));
    expect(await setPlaylistCover("p", new Blob(), "Too large", encode)).toBe(false);
    expect(encode.mock.calls.map((call) => call[1])).toEqual([0.86, 0.7]);
    expect(mocks.client.setCover).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith({ message: "Too large", variant: "error" });
  });

  it("an image the browser cannot read fails with the same toast", async () => {
    expect(await setPlaylistCover("p", new Blob(), "Too large", async () => Promise.reject(new Error("decode")))).toBe(false);
    expect(mocks.show).toHaveBeenCalledWith({ message: "Too large", variant: "error" });
  });

  it("picks through main's dialog and never takes a path", async () => {
    const pick = vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array([1, 2, 3]), mime: "image/png" }));
    (globalThis as { window?: unknown }).window = { nuvoShell: { pickCoverImage: pick } };
    const blob = await pickPlaylistCover();
    expect(pick).toHaveBeenCalledWith();
    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(3);
    pick.mockResolvedValueOnce({ ok: false as never, error: "cancelled" } as never);
    expect(await pickPlaylistCover()).toBeNull();
  });
});
