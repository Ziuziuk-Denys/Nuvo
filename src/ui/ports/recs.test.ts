import { describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  artist: vi.fn(),
  fetch: vi.fn(),
  playList: vi.fn(),
  catalog: vi.fn(),
  warm: vi.fn(),
}));

vi.mock("@/engine", () => ({ player: () => ({ playList: mocks.playList }), usePlayerView: vi.fn(), catalog: mocks.catalog, warmPool: mocks.warm }));
vi.mock("@/engine/boot", () => ({ CORE_BASE_URL: "http://core" }));
vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ catalog: { track: mocks.track, artist: mocks.artist } }) }));
vi.stubGlobal("fetch", mocks.fetch);

import { playSuggestions, recsChanged, seedFavorites, suggest, useWarmup, warmHome } from "./recs";

const yt = (id: string) => ({ id, title: `Song ${id}`, artists: [{ id: "a1", name: "Nova" }], durationMs: 1000 });

afterEach(() => vi.clearAllMocks());

describe("seedFavorites", () => {
  it("saves each song and each artist's top tracks once as starters, then tells Home", async () => {
    mocks.track.mockResolvedValue(yt("s1"));
    mocks.artist.mockResolvedValue({ tracks: [yt("s1"), yt("t2"), yt("t3"), yt("t4")] });
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    const changed = vi.fn();
    recsChanged.addEventListener("change", changed);

    const seeds = await seedFavorites([
      { kind: "song", id: "s1", title: "Song s1" },
      { kind: "artist", id: "a1", title: "Nova" },
    ]);
    expect(seeds.map((track) => track.id)).toEqual(["s1", "t2", "t3"]);

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://core/v1/recs/starters");
    const body = JSON.parse(init.body as string) as { tracks: Array<{ id: string }> };
    expect(body.tracks.map((track) => track.id)).toEqual(["s1", "t2", "t3"]);
    expect(changed).toHaveBeenCalledOnce();
    recsChanged.removeEventListener("change", changed);
  });

  it("keeps a track from every pick when more picks than starters come in", async () => {
    mocks.artist.mockImplementation(async (id: string) => ({ tracks: [yt(`${id}-1`), yt(`${id}-2`), yt(`${id}-3`)] }));
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    const picks = Array.from({ length: 12 }, (_, index) => ({ kind: "artist" as const, id: `a${index}`, title: `Artist ${index}` }));

    const seeds = await seedFavorites(picks);
    expect(seeds).toHaveLength(15);
    expect(picks.every((pick) => seeds.some((track) => track.id === `${pick.id}-1`))).toBe(true);
    expect(seeds[0].id).toBe("a0-1");
  });

  it("fails when the catalog finds nothing or the daemon refuses", async () => {
    mocks.track.mockRejectedValue(new Error("offline"));
    await expect(seedFavorites([{ kind: "song", id: "s1", title: "x" }])).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.track.mockResolvedValue(yt("s1"));
    mocks.fetch.mockResolvedValue(new Response(null, { status: 423 }));
    await expect(seedFavorites([{ kind: "song", id: "s1", title: "x" }])).rejects.toThrow(/locked/);
  });
});

describe("Home warm-up", () => {
  const mixes = (count: number) => Response.json({ items: count ? [{ id: "daily-mix-discover", title: "New", description: "", tracks: [yt("n1")] }] : [] });

  it("starts from the first song of each pick and keeps Home building until a list is stored", async () => {
    mocks.track.mockResolvedValue(yt("s1"));
    mocks.artist.mockResolvedValue({ tracks: [yt("s1"), yt("t2")] });
    mocks.fetch.mockImplementation(async (url: string) => (url.endsWith("/starters") ? new Response(null, { status: 204 }) : mixes(1)));
    let finish = () => {};
    mocks.warm.mockImplementation((_seeds: string[], stored: () => void) => new Promise<void>((resolve) => (finish = () => (stored(), resolve()))));
    const changed = vi.fn();
    recsChanged.addEventListener("change", changed);

    await seedFavorites([
      { kind: "artist", id: "a1", title: "Nova" },
      { kind: "song", id: "s9", title: "Song s1" },
    ]);
    expect(mocks.warm).toHaveBeenCalledWith(["s1"], expect.any(Function));
    expect(useWarmup.getState().phase).toBe("building");
    finish();
    await vi.waitFor(() => expect(useWarmup.getState().phase).toBe("idle"));
    expect(changed).toHaveBeenCalledTimes(2);
    recsChanged.removeEventListener("change", changed);
  });

  it("fails when no source stored anything, and a retry warms the same seeds again", async () => {
    mocks.warm.mockResolvedValue(undefined);
    await warmHome(["s1", "t2"]);
    expect(useWarmup.getState()).toEqual({ phase: "failed", seeds: ["s1", "t2"] });
    mocks.warm.mockImplementation(async (_seeds: string[], stored: () => void) => stored());
    mocks.fetch.mockResolvedValue(mixes(1));
    await warmHome(useWarmup.getState().seeds);
    expect(mocks.warm).toHaveBeenLastCalledWith(["s1", "t2"], expect.any(Function));
    expect(useWarmup.getState().phase).toBe("idle");
  });
});

describe("playlist suggestions", () => {
  it("are empty for an empty playlist and on any failure", async () => {
    expect(await suggest("p1", [])).toEqual([]);
    mocks.catalog.mockImplementation(() => {
      throw new Error("engine not started");
    });
    expect(await suggest("p1", ["t1"])).toEqual([]);
  });

  it("play without their reasons, in the playlist's suggest context", () => {
    const pick = { id: "a", title: "A", artists: "Nova", coverUrl: "", durationMs: 1, reason: { kind: "new" as const } };
    playSuggestions("p1", [pick, { ...pick, id: "b", reason: undefined }], 1);
    const [tracks, options] = mocks.playList.mock.calls[0] as [Array<Record<string, unknown>>, unknown];
    expect(tracks.map((track) => "reason" in track)).toEqual([false, false]);
    expect(options).toEqual({ startAt: 1, context: "suggest:p1" });
  });
});
