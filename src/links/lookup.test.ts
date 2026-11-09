// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchJson, lookupApple, lookupDeezer, lookupShazam, lookupYandex, type FetchJson } from "./lookup";

function fixture(table: Record<string, { status: number; body: unknown }>): FetchJson & { urls: string[] } {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    return table[url] ?? { status: 404, body: null };
  };
  return Object.assign(get, { urls });
}

const signal = new AbortController().signal;
const APPLE_TRACK = {
  resultCount: 1,
  results: [
    {
      wrapperType: "track",
      kind: "song",
      trackId: 1443818368,
      trackName: "I Will Survive",
      artistName: "Gloria Gaynor",
      collectionName: "The Best of Gloria Gaynor",
      trackTimeMillis: 198066,
    },
  ],
};
const APPLE_ALBUM = {
  resultCount: 1,
  results: [
    {
      wrapperType: "collection",
      collectionId: 1443818103,
      collectionName: "The Best of Gloria Gaynor",
      artistName: "Gloria Gaynor",
    },
  ],
};
const DEEZER_TRACK = {
  id: 3135556,
  title: "Harder, Better, Faster, Stronger",
  duration: 226,
  isrc: "GBDUW0000059",
  artist: { id: 27, name: "Daft Punk" },
};
const DEEZER_GONE = {
  error: { type: "DataException", message: "no data", code: 800 },
};
const YANDEX_TRACK = {
  result: [
    {
      id: "57703",
      title: "Группа крови",
      version: "Remastered",
      durationMs: 287_000,
      artists: [{ id: 1, name: "Кино" }],
    },
  ],
};

describe("Apple Music", () => {
  it("reads a track id with its storefront", async () => {
    const get = fixture({
      "https://itunes.apple.com/lookup?id=1443818368&country=gb": {
        status: 200,
        body: APPLE_TRACK,
      },
    });
    expect(await lookupApple("1443818368", "gb", get, signal)).toEqual({
      kind: "song",
      source: {
        title: "I Will Survive",
        artists: ["Gloria Gaynor"],
        durationMs: 198066,
      },
    });
  });

  it("refuses an album id and reports an unreachable service", async () => {
    const get = fixture({
      "https://itunes.apple.com/lookup?id=1443818103&country=us": {
        status: 200,
        body: APPLE_ALBUM,
      },
    });
    expect(await lookupApple("1443818103", "us", get, signal)).toEqual({
      kind: "error",
      code: "unavailable",
    });
    expect(await lookupApple("1", "us", async () => ({ status: 0, body: null }), signal)).toEqual({ kind: "error", code: "network" });
  });
});

describe("Deezer", () => {
  it("keeps the ISRC", async () => {
    const get = fixture({
      "https://api.deezer.com/track/3135556": {
        status: 200,
        body: DEEZER_TRACK,
      },
    });
    expect(await lookupDeezer("3135556", get, signal)).toEqual({
      kind: "song",
      source: {
        title: "Harder, Better, Faster, Stronger",
        artists: ["Daft Punk"],
        durationMs: 226_000,
      },
      isrc: "GBDUW0000059",
    });
  });

  it("an error body is unavailable", async () => {
    const get = fixture({
      "https://api.deezer.com/track/1": { status: 200, body: DEEZER_GONE },
    });
    expect(await lookupDeezer("1", get, signal)).toEqual({
      kind: "error",
      code: "unavailable",
    });
  });
});

describe("Yandex Music", () => {
  it("joins the version to the title", async () => {
    const get = fixture({
      "https://api.music.yandex.net/tracks/57703": {
        status: 200,
        body: YANDEX_TRACK,
      },
    });
    expect(await lookupYandex("57703", get, signal)).toEqual({
      kind: "song",
      source: {
        title: "Группа крови (Remastered)",
        artists: ["Кино"],
        durationMs: 287_000,
      },
    });
  });

  it.each([451, 403])("%i is region_blocked", async (status) => {
    expect(await lookupYandex("57703", async () => ({ status, body: null }), signal)).toEqual({ kind: "error", code: "region_blocked" });
  });
});

describe("Shazam", () => {
  it("uses the Apple id when it is a track, else the slug", async () => {
    const get = fixture({
      "https://itunes.apple.com/lookup?id=1443818368&country=us": {
        status: 200,
        body: APPLE_TRACK,
      },
    });
    expect(await lookupShazam("i will survive", "1443818368", get, signal)).toMatchObject({ source: { artists: ["Gloria Gaynor"] } });
    expect(await lookupShazam("i will survive", "999", get, signal)).toEqual({
      kind: "song",
      source: { title: "i will survive", artists: [] },
    });
    expect(await lookupShazam("i will survive", undefined, get, signal)).toEqual({
      kind: "song",
      source: { title: "i will survive", artists: [] },
    });
  });
});

describe("the real fetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends no cookies or referrer and parses JSON", async () => {
    const fetch = vi.fn(async () => new Response('{"a":1}'));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchJson("https://x.test", signal)).toEqual({
      status: 200,
      body: { a: 1 },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://x.test",
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("drops an oversized or broken body, reports a dead network, passes an abort", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1))),
    );
    expect(await fetchJson("https://x.test", signal)).toEqual({
      status: 200,
      body: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("down"))),
    );
    expect(await fetchJson("https://x.test", signal)).toEqual({
      status: 0,
      body: null,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(fetchJson("https://x.test", controller.signal)).rejects.toThrow();
  });
});

describe.skipIf(!process.env.NUVO_LIVE)("live services (NUVO_LIVE=1)", () => {
  it("iTunes and Deezer answer without a token", async () => {
    expect(await lookupApple("1443818368", "us", fetchJson, signal)).toMatchObject({ kind: "song", source: { title: "I Will Survive" } });
    expect(await lookupDeezer("3135556", fetchJson, signal)).toMatchObject({
      kind: "song",
      isrc: "GBDUW0000059",
    });
  }, 20_000);

  it("watch_videos with 50 ids redirects to an anonymous list", async () => {
    const ids = ["dQw4w9WgXcQ", "kJQP7kiw5Fk", "9bZkp7q19f0", "JGwWNGJdvx8", "OPf0YbXqDm0"];
    const list = Array.from({ length: 50 }, (_, i) => ids[i % ids.length]).join(",");
    const response = await fetch(`https://www.youtube.com/watch_videos?video_ids=${list}`, { redirect: "manual" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("list=TLGG");
  }, 20_000);
});
