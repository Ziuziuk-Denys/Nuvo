import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_PINS_KEY, livePins, loadPins, useHomePinsStore, useRailPinsStore, type HomePin } from "./pins";

const playlist = (id: string): HomePin => ({
  kind: "playlist",
  id,
  title: `Playlist ${id}`,
  href: `/library/playlist?id=${id}`,
});

const sent: Array<{ key: string; body?: unknown }> = [];
let flags: unknown[] = [];

beforeEach(() => {
  sent.length = 0;
  flags = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("nuvo-core://local", "")}`;
      sent.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(key === "GET /v1/me/flags" ? { items: flags } : {}), { status: 200 });
    }),
  );
  useHomePinsStore.setState({ pins: [] });
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("homePinsStore", () => {
  it("pins newest first in the daemon's flags and unpins by kind and id", async () => {
    const { pin, unpin, isPinned } = useHomePinsStore.getState();
    pin(playlist("1"));
    await settle();
    pin({ kind: "album", id: "1", title: "Album", href: "/collection?type=album&id=1" });
    await settle();
    expect(useHomePinsStore.getState().pins.map((p) => p.kind)).toEqual(["album", "playlist"]);
    expect(isPinned("playlist", "1")).toBe(true);
    expect(sent.at(-2)).toEqual({
      key: "PUT /v1/me/flags/album/1",
      body: { pinned: true, snapshot: { title: "Album", href: "/collection?type=album&id=1" } },
    });
    expect(sent.at(-1)).toEqual({
      key: "POST /v1/me/flags/pin-order",
      body: {
        items: [
          { kind: "album", id: "1" },
          { kind: "playlist", id: "1" },
        ],
      },
    });

    unpin("playlist", "1");
    await settle();
    expect(isPinned("playlist", "1")).toBe(false);
    expect(isPinned("album", "1")).toBe(true);
    expect(sent.at(-1)).toEqual({ key: "PUT /v1/me/flags/playlist/1", body: { pinned: false } });
  });

  it("moves a re-pinned item to the front without duplicating it", () => {
    const { pin } = useHomePinsStore.getState();
    pin(playlist("1"));
    pin(playlist("2"));
    pin(playlist("1"));
    expect(useHomePinsStore.getState().pins.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("keeps every pin: the old cap of seven was only the browser store's", () => {
    for (let i = 0; i < 9; i++) useHomePinsStore.getState().pin(playlist(String(i)));
    expect(useHomePinsStore.getState().pins).toHaveLength(9);
  });

  it("reads pins from the daemon, skipping hidden rows and rows with no page", async () => {
    flags = [
      { kind: "artist", id: "a", pinned: true, hidden: false, snapshot: { title: "Ann", href: "/artist?id=a" } },
      { kind: "album", id: "h", pinned: false, hidden: true, snapshot: { title: "Hidden", href: "/collection?type=album&id=h" } },
      { kind: "album", id: "x", pinned: true, hidden: false, snapshot: null },
    ];
    await loadPins({ getItem: () => null, removeItem: vi.fn() });
    expect(useHomePinsStore.getState().pins).toEqual([{ kind: "artist", id: "a", title: "Ann", href: "/artist?id=a" }]);
  });

  it("moves the pins an older version kept in the browser into the daemon, in their order, then forgets them", async () => {
    const legacy = [playlist("new"), { kind: "album", id: "old", title: "Old", href: "/collection?type=album&id=old" }];
    const storage = { getItem: vi.fn(() => JSON.stringify({ state: { pins: legacy }, version: 0 })), removeItem: vi.fn() };
    await loadPins(storage);
    expect(sent.map((call) => call.key)).toEqual([
      "PUT /v1/me/flags/playlist/new",
      "PUT /v1/me/flags/album/old",
      "POST /v1/me/flags/pin-order",
      "GET /v1/me/flags",
    ]);
    expect(sent[2].body).toEqual({
      items: [
        { kind: "playlist", id: "new" },
        { kind: "album", id: "old" },
      ],
    });
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_PINS_KEY);
  });

  it("keeps the old pins for the next try when the daemon cannot take them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 423 })),
    );
    const storage = { getItem: () => JSON.stringify({ state: { pins: [playlist("1")] } }), removeItem: vi.fn() };
    await expect(loadPins(storage)).rejects.toThrow();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe("livePins", () => {
  const pins: HomePin[] = [
    playlist("gone"),
    playlist("kept"),
    { kind: "playlist", id: "saved", title: "Saved", href: "/collection?type=playlist&id=saved" },
    { kind: "artist", id: "a", title: "Artist", href: "/artist?id=a" },
  ];

  it("drops own playlists that are no longer in the library", () => {
    expect(livePins(pins, ["kept"]).map((p) => p.id)).toEqual(["kept", "saved", "a"]);
  });

  it("keeps every pin while the playlist list is still loading", () => {
    expect(livePins(pins, null)).toEqual(pins);
  });
});

describe("pruneOwnPlaylists", () => {
  it("removes own playlists missing from the library and keeps the rest", () => {
    const saved: HomePin = { kind: "playlist", id: "s", title: "Saved", href: "/collection?type=playlist&id=s" };
    useHomePinsStore.setState({ pins: [playlist("gone"), playlist("kept"), saved] });
    useHomePinsStore.getState().pruneOwnPlaylists(["kept"]);
    expect(useHomePinsStore.getState().pins.map((p) => p.id)).toEqual(["kept", "s"]);
  });
});

describe("railPinsStore", () => {
  it("keeps its own six pins, apart from Home's", () => {
    useHomePinsStore.setState({ pins: [] });
    useRailPinsStore.setState({ pins: [] });
    for (const id of ["1", "2", "3", "4", "5", "6", "7"]) useRailPinsStore.getState().pin(playlist(id));
    expect(useRailPinsStore.getState().pins.map((p) => p.id)).toEqual(["7", "6", "5", "4", "3", "2"]);
    expect(useHomePinsStore.getState().pins).toEqual([]);
  });
});
