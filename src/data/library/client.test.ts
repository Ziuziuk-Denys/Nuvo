import { describe, expect, it, vi, afterEach } from "vitest";
import { libraryClient } from "./client";

const snap = (id: string) => ({
  id,
  title: `T ${id}`,
  artists: [{ id: "a1", name: "Ann" }],
  durationMs: 1000,
  cover: { url: `https://img/${id}.jpg`, width: 1, height: 1 },
});
const sent: Array<{ key: string; body?: unknown; type?: string }> = [];

function daemon(routes: Record<string, unknown>) {
  sent.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("nuvo-core://local", "")}`;
      const body = init?.body instanceof Blob ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
      const type = new Headers(init?.headers).get("content-type");
      sent.push({ key, body, ...(type && type !== "application/json" ? { type } : {}) });
      const value = routes[key];
      return value === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value), { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("libraryClient", () => {
  it("reads liked pages and ids", async () => {
    daemon({
      "GET /v1/me/library/tracks?limit=100&cursor=c%7C1": { items: [{ track: snap("a"), likedAt: "x" }], nextCursor: null },
      "GET /v1/me/library/track-ids": { ids: ["a", "b"] },
    });
    const page = await libraryClient.likedPage(100, "c|1");
    expect(page).toEqual({ tracks: [expect.objectContaining({ id: "a", artists: "Ann", coverUrl: "https://img/a.jpg" })], next: null });
    await expect(libraryClient.likedIds()).resolves.toEqual(["a", "b"]);
  });

  it("likes with the daemon's snapshot form", async () => {
    daemon({});
    await libraryClient.like({ id: "a", title: "T", artists: "Ann", coverUrl: "https://img/a.jpg", durationMs: 1000 });
    expect(sent[0]).toEqual({
      key: "PUT /v1/me/library/tracks/a",
      body: { track: expect.objectContaining({ id: "a", artists: [{ id: "unknown", name: "Ann" }] }) },
    });
  });

  it("maps the playlist list and a detail with item ids", async () => {
    const playlist = {
      id: "p",
      title: "Mix",
      createdAt: "1",
      updatedAt: "2",
      revision: 3,
      isPublic: false,
      pinnedOffline: false,
      ownerId: "local",
      sortMode: "manual",
      sortDesc: false,
    };
    daemon({
      "GET /v1/me/playlists": { items: [{ ...playlist, trackCount: 2, covers: ["u1"] }] },
      "GET /v1/me/playlists/p": { playlist, items: [{ id: "i1", track: snap("a"), position: 1, addedAt: "x" }] },
    });
    await expect(libraryClient.playlists()).resolves.toEqual([expect.objectContaining({ id: "p", trackCount: 2, covers: ["u1"], coverUrl: null })]);
    const detail = await libraryClient.playlist("p");
    expect(detail.tracks[0]).toMatchObject({ id: "a", playlistItemId: "i1" });
    expect(detail).toMatchObject({ sortMode: "manual", pinnedOffline: false });
  });

  it("stores a playlist's order, recently added newest first", async () => {
    daemon({});
    await libraryClient.setSort("p", "added");
    await libraryClient.setSort("p", "artist");
    expect(sent.map((call) => call.body)).toEqual([
      { sortMode: "added", sortDesc: true },
      { sortMode: "artist", sortDesc: false },
    ]);
    expect(sent[0].key).toBe("PATCH /v1/me/playlists/p");
  });

  it("trims and caps a new playlist's title and description", async () => {
    daemon({ "POST /v1/me/playlists": { id: "n", title: "x", createdAt: "1", updatedAt: "1", revision: 0 } });
    await libraryClient.createPlaylist(`  ${"t".repeat(300)}  `, "d".repeat(3000));
    expect(sent[0].body).toEqual({ title: "t".repeat(200), description: "d".repeat(2000) });
  });

  it("saved items use plural routes and unwrap the kind key", async () => {
    daemon({ "GET /v1/me/library/albums": { items: [{ album: { id: "al", title: "Al" }, savedAt: "2026-01-01T00:00:00Z" }] } });
    await expect(libraryClient.saved("album")).resolves.toEqual([
      { kind: "album", id: "al", snapshot: { id: "al", title: "Al" }, savedAt: "2026-01-01T00:00:00Z" },
    ]);
    await libraryClient.save("artist", "ar", { id: "ar", name: "N" });
    expect(sent.at(-1)).toEqual({ key: "PUT /v1/me/library/artists/ar", body: { snapshot: { id: "ar", name: "N" } } });
  });

  it("sets a description, and a blank one clears it", async () => {
    daemon({});
    await libraryClient.setDescription("p", "  hello ");
    await libraryClient.setDescription("p", "   ");
    expect(sent.map((call) => call.body)).toEqual([{ description: "hello" }, { description: null }]);
    expect(sent[0].key).toBe("PATCH /v1/me/playlists/p");
  });

  it("lists a playlist's items with their positions and dates, and puts removed ones back", async () => {
    daemon({
      "GET /v1/me/playlists/p%201": { playlist: { id: "p 1" }, items: [{ id: "i1", track: snap("t1"), position: 2.5, addedAt: "2026-01-01T00:00:00Z" }] },
      "POST /v1/me/playlists/p%201/items/insert": { items: [], added: 1, rejected: 0 },
    });
    await expect(libraryClient.playlistItems("p 1")).resolves.toEqual([{ id: "i1", trackId: "t1", position: 2.5, addedAt: "2026-01-01T00:00:00Z" }]);
    const items = [{ trackId: "t1", position: 2.5, addedAt: "2026-01-01T00:00:00Z" }];
    await expect(libraryClient.insertItems("p 1", items)).resolves.toEqual({ added: 1, rejected: 0 });
    expect(sent.at(-1)).toMatchObject({ key: "POST /v1/me/playlists/p%201/items/insert", body: { items } });
  });

  it("uploads a cover as raw image bytes with its type, and removes it", async () => {
    daemon({ "PUT /v1/me/playlists/p/cover": { id: "p" } });
    const image = new Blob([new Uint8Array([1, 2])], { type: "image/webp" });
    await libraryClient.setCover("p", image);
    expect(sent.at(-1)).toMatchObject({ key: "PUT /v1/me/playlists/p/cover", body: image, type: "image/webp" });
    await libraryClient.removeCover("p");
    expect(sent.at(-1)?.key).toBe("DELETE /v1/me/playlists/p/cover");
  });
});
