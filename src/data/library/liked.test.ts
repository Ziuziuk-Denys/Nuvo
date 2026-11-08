import { describe, expect, it, vi } from "vitest";
import { CoreError } from "@/imports/core";
import type { Track } from "@/engine/types";
import { LIKED_PAGE, createLiked } from "./liked";

const track = (id: string): Track => ({ id, title: id, artists: "A", coverUrl: "", durationMs: 1 });
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(total = 1000) {
  const all = Array.from({ length: total }, (_, i) => track(`t${i}`));
  const client = {
    likedPage: vi.fn(async (limit: number, cursor?: string) => {
      const start = cursor ? Number(cursor) : 0;
      return { tracks: all.slice(start, start + limit), next: start + limit < all.length ? String(start + limit) : null };
    }),
    likedIds: vi.fn(async () => all.map((t) => t.id)),
    like: vi.fn(async (_track?: Track): Promise<void> => undefined),
    unlike: vi.fn(async (_id?: string): Promise<void> => undefined),
  };
  const onError = vi.fn();
  const liked = createLiked({ client, onError, onChange: vi.fn() });
  return { liked, client, onError };
}

describe("liked tracks", () => {
  it("24: opening asks for the first page of 100 only", async () => {
    const { liked, client } = setup();
    await liked.load();
    expect(client.likedPage).toHaveBeenCalledTimes(1);
    expect(client.likedPage).toHaveBeenCalledWith(LIKED_PAGE);
    expect(liked.store.getState().tracks).toHaveLength(100);
  });

  it("25: isLiked is a set lookup over ids", async () => {
    const { liked } = setup(10_000);
    await liked.load();
    expect(liked.isLiked("t9999")).toBe(true);
    expect(liked.isLiked("nope")).toBe(false);
  });

  it("26: a failed like shows at once and rolls back with the error", async () => {
    const { liked, client, onError } = setup(0);
    await liked.load();
    const write = deferred();
    client.like.mockReturnValueOnce(write.promise);
    const pending = liked.like(track("x"));
    expect(liked.isLiked("x")).toBe(true);
    expect(liked.store.getState().tracks[0].id).toBe("x");
    write.reject(new CoreError(500, "HTTP_500"));
    await expect(pending).rejects.toBeInstanceOf(CoreError);
    expect(liked.isLiked("x")).toBe(false);
    expect(liked.store.getState().tracks).toHaveLength(0);
    expect(onError).toHaveBeenCalled();
  });

  it("27: two quick opposite presses end in the last one, and reach the daemon in order", async () => {
    const { liked, client } = setup(0);
    await liked.load();
    const first = deferred();
    client.like.mockReturnValueOnce(first.promise);
    const a = liked.like(track("x"));
    const b = liked.unlike("x");
    expect(client.unlike).not.toHaveBeenCalled();
    first.resolve();
    await Promise.all([a, b]);
    expect(client.unlike).toHaveBeenCalledTimes(1);
    expect(liked.isLiked("x")).toBe(false);
  });

  it("a locked daemon rolls the heart back", async () => {
    const { liked, client } = setup(3);
    await liked.load();
    client.unlike.mockRejectedValueOnce(new CoreError(423, "LOCKED"));
    await expect(liked.unlike("t1")).rejects.toBeInstanceOf(CoreError);
    expect(liked.isLiked("t1")).toBe(true);
    expect(liked.store.getState().tracks.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
  });

  it("a failed first load is an error, not an empty library", async () => {
    const { liked, client } = setup();
    client.likedPage.mockRejectedValueOnce(new CoreError(0, "CORE_DOWN"));
    await liked.load();
    expect(liked.store.getState().status).toBe("error");
  });

  it("33: a refresh after load keeps the status ready", async () => {
    const { liked } = setup(5);
    await liked.load();
    const states: string[] = [];
    liked.store.subscribe((state) => states.push(state.status));
    await liked.refresh();
    expect(states.every((status) => status === "ready")).toBe(true);
  });

  it("play all pages through every track", async () => {
    const { liked } = setup(250);
    await expect(liked.allTracks()).resolves.toHaveLength(250);
  });

  it("a failed like then a failed unlike end in the daemon's real state, unliked", async () => {
    const { liked, client } = setup(0);
    await liked.load();
    client.like.mockRejectedValueOnce(new CoreError(500, "HTTP_500"));
    client.unlike.mockRejectedValueOnce(new CoreError(500, "HTTP_500"));
    const a = liked.like(track("x"));
    const b = liked.unlike("x");
    await expect(a).rejects.toBeInstanceOf(CoreError);
    await expect(b).rejects.toBeInstanceOf(CoreError);
    expect(liked.isLiked("x")).toBe(false);
    expect(liked.store.getState().tracks).toHaveLength(0);
  });

  it("a failed unlike after a confirmed like stays liked", async () => {
    const { liked, client } = setup(0);
    await liked.load();
    await liked.like(track("x"));
    client.unlike.mockRejectedValueOnce(new CoreError(500, "HTTP_500"));
    await expect(liked.unlike("x")).rejects.toBeInstanceOf(CoreError);
    expect(liked.isLiked("x")).toBe(true);
    expect(liked.store.getState().tracks.map((t) => t.id)).toEqual(["x"]);
  });

  it("a refresh while a like is in flight keeps the like", async () => {
    const { liked, client } = setup(0);
    await liked.load();
    const write = deferred();
    client.like.mockReturnValueOnce(write.promise);
    const pending = liked.like(track("x"));
    await liked.refresh();
    expect(liked.isLiked("x")).toBe(true);
    expect(liked.store.getState().tracks.map((t) => t.id)).toEqual(["x"]);
    write.resolve();
    await pending;
  });

  it("a refresh while an unlike is in flight keeps the track gone", async () => {
    const { liked, client } = setup(3);
    await liked.load();
    const write = deferred();
    client.unlike.mockReturnValueOnce(write.promise);
    const pending = liked.unlike("t1");
    await liked.refresh();
    expect(liked.isLiked("t1")).toBe(false);
    expect(liked.store.getState().tracks.map((t) => t.id)).toEqual(["t0", "t2"]);
    write.resolve();
    await pending;
  });

  it("a snapshot read before a write settled does not undo it", async () => {
    const { liked, client } = setup(0);
    await liked.load();
    let release!: () => void;
    client.likedIds.mockImplementationOnce(() => new Promise<string[]>((resolve) => (release = () => resolve([]))));
    const refreshing = liked.refresh();
    await liked.like(track("x"));
    release();
    await refreshing;
    expect(liked.isLiked("x")).toBe(true);
  });

  it("a refresh started by one write's change notice keeps another pending write", async () => {
    const all = [track("a"), track("b")];
    const serverIds = new Set<string>();
    const client = {
      likedPage: vi.fn(async () => ({ tracks: all.filter((t) => serverIds.has(t.id)), next: null })),
      likedIds: vi.fn(async () => [...serverIds]),
      like: vi.fn(async (t?: Track) => void serverIds.add(t!.id)),
      unlike: vi.fn(async (id?: string) => void serverIds.delete(id!)),
    };
    const slow = deferred();
    client.like.mockImplementationOnce(() => slow.promise.then(() => undefined));
    const refreshes: Promise<void>[] = [];
    const liked = createLiked({ client, onError: vi.fn(), onChange: () => void refreshes.push(liked.refresh()) });
    await liked.load();
    const a = liked.like(all[0]);
    await liked.like(all[1]);
    await Promise.all(refreshes);
    expect(liked.isLiked("a")).toBe(true);
    slow.resolve();
    await a;
  });

  it("loadMore does not bring back a track unliked while the page was loading", async () => {
    const { liked, client } = setup(250);
    await liked.load();
    let release!: () => void;
    client.likedPage.mockImplementationOnce(async (limit: number, cursor?: string) => {
      await new Promise<void>((resolve) => (release = resolve));
      const start = Number(cursor);
      return { tracks: Array.from({ length: limit }, (_, i) => track(`t${start + i}`)), next: String(start + limit) };
    });
    const more = liked.loadMore();
    await liked.unlike("t150");
    release();
    await more;
    expect(liked.store.getState().tracks.some((t) => t.id === "t150")).toBe(false);
    expect(liked.isLiked("t150")).toBe(false);
  });
});
