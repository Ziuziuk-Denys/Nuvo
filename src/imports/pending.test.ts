import { describe, expect, it, vi } from "vitest";
import { summary } from "./fixtures/fakeDaemon";
import { resumePendingTrack, snapshotOf, watchPendingTrack } from "./pending";
import type { CatalogTrack } from "./types";

const song: CatalogTrack = {
  id: "aaaaaaaaaaa",
  title: "Paper Moons",
  artists: [{ id: "UC1", name: "Mira Holt" }],
  durationMs: 201_000,
};

describe("watchPendingTrack", () => {
  it("adds the waiting song once, when a summary first names the playlist", async () => {
    const ports = {
      addToPlaylist: vi.fn(async () => {}),
      added: vi.fn(),
      failed: vi.fn(),
    };
    const pending = watchPendingTrack(song, ports);
    pending.summary(summary("i1", { targetId: undefined }));
    pending.summary(summary("i1", { targetId: "pl-1" }));
    pending.summary(summary("i1", { targetId: "pl-1", done: 2 }));
    await Promise.resolve();
    expect(ports.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(ports.addToPlaylist).toHaveBeenCalledWith("pl-1", song);
    expect(ports.added).toHaveBeenCalledWith("Paper Moons");
  });

  it("says so when adding fails", async () => {
    const ports = {
      addToPlaylist: vi.fn(async () => Promise.reject(new Error("x"))),
      added: vi.fn(),
      failed: vi.fn(),
    };
    watchPendingTrack(song, ports, { sleep: async () => {} }).summary(summary("i1"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ports.failed).toHaveBeenCalled();
    expect(ports.added).not.toHaveBeenCalled();
  });

  it("drops the song when the import fails first, and ignores Liked songs targets", () => {
    const ports = {
      addToPlaylist: vi.fn(async () => {}),
      added: vi.fn(),
      failed: vi.fn(),
    };
    const liked = watchPendingTrack(song, ports);
    liked.summary(summary("i1", { targetKind: "liked", targetId: undefined }));
    const dropped = watchPendingTrack(song, ports);
    dropped.dropped();
    dropped.summary(summary("i2"));
    expect(ports.addToPlaylist).not.toHaveBeenCalled();
  });
});

describe("a waiting song that does not get in at once", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const store = () => ({ save: vi.fn(), clear: vi.fn() });

  it("retries a failed add a few times and adds the song once", async () => {
    const addToPlaylist = vi
      .fn<(id: string, track: CatalogTrack) => Promise<void>>()
      .mockRejectedValueOnce(new Error("x"))
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce(undefined);
    const ports = { addToPlaylist, added: vi.fn(), failed: vi.fn() };
    const kept = store();
    const pending = watchPendingTrack(song, ports, {
      sleep: async () => {},
      store: kept,
    });
    pending.summary(summary("i1", { targetId: "pl-1" }));
    pending.summary(summary("i1", { targetId: "pl-1", done: 1 }));
    await flush();
    expect(addToPlaylist).toHaveBeenCalledTimes(3);
    expect(ports.added).toHaveBeenCalledTimes(1);
    expect(ports.failed).not.toHaveBeenCalled();
    expect(kept.save).toHaveBeenCalledWith({ playlistId: "pl-1", track: song });
    expect(kept.clear).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded tries, says so once and keeps the song for the next start", async () => {
    const ports = {
      addToPlaylist: vi.fn(async () => Promise.reject(new Error("x"))),
      added: vi.fn(),
      failed: vi.fn(),
    };
    const kept = store();
    watchPendingTrack(song, ports, {
      sleep: async () => {},
      store: kept,
    }).summary(summary("i1"));
    await flush();
    expect(ports.addToPlaylist.mock.calls.length).toBeGreaterThan(1);
    expect(ports.addToPlaylist.mock.calls.length).toBeLessThanOrEqual(5);
    expect(ports.failed).toHaveBeenCalledTimes(1);
    expect(kept.clear).not.toHaveBeenCalled();
  });

  it("adds a saved song after a restart and forgets it", async () => {
    const ports = {
      addToPlaylist: vi.fn(async () => {}),
      added: vi.fn(),
      failed: vi.fn(),
    };
    const kept = store();
    await resumePendingTrack({ playlistId: "pl-1", track: song }, ports, {
      sleep: async () => {},
      store: kept,
    });
    expect(ports.addToPlaylist).toHaveBeenCalledWith("pl-1", song);
    expect(ports.added).toHaveBeenCalledWith("Paper Moons");
    expect(kept.clear).toHaveBeenCalledTimes(1);
  });
});

describe("snapshotOf", () => {
  it("turns a player track into a playlist snapshot", () => {
    expect(
      snapshotOf({
        id: "sc:42",
        title: "Paper Moons",
        artists: "Mira Holt",
        artistList: [{ id: "sc_user_9", name: "Mira Holt" }],
        coverUrl: "https://i1.sndcdn.com/a.jpg",
        durationMs: 201_000,
      }),
    ).toEqual({
      id: "sc:42",
      title: "Paper Moons",
      artists: [{ id: "sc_user_9", name: "Mira Holt" }],
      durationMs: 201_000,
      cover: { url: "https://i1.sndcdn.com/a.jpg" },
    });
    expect(
      snapshotOf({
        id: "aaaaaaaaaaa",
        title: "Glass River",
        artists: "Nadia Rowe, Tomas Vey",
      }).artists,
    ).toEqual([
      { id: "", name: "Nadia Rowe" },
      { id: "", name: "Tomas Vey" },
    ]);
  });
});
