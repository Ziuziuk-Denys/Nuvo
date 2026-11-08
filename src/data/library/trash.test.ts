import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteKeepingSnapshot, restoreDeleted, useRecentlyDeleted } from "./trash";

const sent: Array<{ key: string; body?: unknown }> = [];
const playlist = {
  id: "p1",
  title: "Gym",
  isPublic: false,
  pinnedOffline: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  revision: 4,
  ownerId: "local",
  sortMode: "title",
  sortDesc: false,
  coverUrl: "nuvo-core://local/v1/me/playlists/p1/cover?v=1",
};

beforeEach(() => {
  sent.length = 0;
  useRecentlyDeleted.setState({ items: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("nuvo-core://local", "")}`;
      sent.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (key === "GET /v1/me/playlists/p1")
        return new Response(JSON.stringify({ playlist, items: [{ id: "i1", track: { id: "t1" }, position: 1.5, addedAt: "2026-01-01T10:00:00.000Z" }] }));
      if (key.startsWith("GET /v1/me/playlists/p1/cover")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("recently deleted playlists", () => {
  it("snapshots the playlist with its places and cover before it goes, and restores it whole", async () => {
    const remove = vi.fn(async () => undefined);
    await deleteKeepingSnapshot("p1", remove);
    expect(remove).toHaveBeenCalled();
    expect(useRecentlyDeleted.getState().items).toMatchObject([{ id: "p1", title: "Gym", trackCount: 1 }]);

    await restoreDeleted("p1");
    const restore = sent.find((call) => call.key === "POST /v1/me/playlists/restore")!;
    expect(restore.body).toEqual({
      snapshots: [
        {
          id: "p1",
          title: "Gym",
          isPublic: false,
          pinnedOffline: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          revision: 4,
          sortMode: "title",
          sortDesc: false,
          items: [{ trackId: "t1", position: 1.5, addedAt: "2026-01-01T10:00:00.000Z" }],
          cover: { mime: "image/webp", base64: "AQID" },
        },
      ],
    });
    expect(useRecentlyDeleted.getState().items).toEqual([]);
  });

  it("keeps the playlist when the snapshot cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const remove = vi.fn(async () => undefined);
    await expect(deleteKeepingSnapshot("p1", remove)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});
