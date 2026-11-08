import { describe, expect, it, vi } from "vitest";
import { LEGACY_COVERS_KEY, dropLegacyLibraryKeys, notifyLibraryChanged, onLibraryChange } from "./changes";
import { createShelf, shelfItems } from "./shelf";

function account(signedIn: boolean, show: boolean) {
  return {
    status: () => signedIn,
    preferences: { get: () => ({ playThroughAccount: true, offerSignIn: false, showAccountPlaylists: show }), set: vi.fn() },
    playlists: vi.fn(async () => [
      { id: "PLmine", title: "Road", subtitle: "Me", coverUrl: "p.jpg" },
      { id: "OLAK5uy_disc", title: "Disc", subtitle: "Ann", coverUrl: "d.jpg" },
    ]),
    onChange: vi.fn(() => () => undefined),
  };
}

describe("YouTube shelf (3.10)", () => {
  it("albums are recognised by the id prefix, order kept", () => {
    const items = shelfItems([
      { id: "PLx", title: "A" },
      { id: "OLAK5uy_y", title: "B" },
    ]);
    expect(items.map((item) => [item.kind, item.source])).toEqual([
      ["playlist", "youtube"],
      ["album", "youtube"],
    ]);
  });

  it("32: preference off or signed out: no request, empty shelf", async () => {
    for (const a of [account(true, false), account(false, true)]) {
      const shelf = createShelf(a as never);
      await shelf.load();
      expect(a.playlists).not.toHaveBeenCalled();
      expect(shelf.store.getState().items).toEqual([]);
    }
  });

  it("is read once per sign-in", async () => {
    const a = account(true, true);
    const shelf = createShelf(a as never);
    await shelf.load();
    await shelf.load();
    expect(a.playlists).toHaveBeenCalledTimes(1);
    expect(shelf.store.getState().items).toHaveLength(2);
  });
});

describe("changes", () => {
  it("33: notify reaches listeners, and the unlock event counts as a change", () => {
    const listener = vi.fn();
    const stop = onLibraryChange(listener);
    notifyLibraryChanged();
    window.dispatchEvent(new Event("library:changed"));
    stop();
    notifyLibraryChanged();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("34: the old cover cache key is removed", () => {
    localStorage.setItem(LEGACY_COVERS_KEY, "{}");
    dropLegacyLibraryKeys();
    expect(localStorage.getItem(LEGACY_COVERS_KEY)).toBeNull();
  });
});
