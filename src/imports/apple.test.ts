import { describe, expect, it, vi } from "vitest";
import { listApple, parseAppleLink } from "./apple";
import { MORNING, applePage } from "./fixtures/apple";
import type { FetchLike } from "./http";
import { detectLink } from "./detect";
import { ImportError } from "./types";

function fakeFetch(pages: Record<string, Response | (() => Response)>) {
  return vi.fn<FetchLike>(async (url) => {
    const page = pages[url];
    if (!page) return new Response("", { status: 404 });
    return typeof page === "function" ? page() : page.clone();
  });
}

const http = (fetch: FetchLike) => ({
  fetch,
  sleep: async () => {},
  signal: new AbortController().signal,
});
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

describe("parseAppleLink", () => {
  it("accepts playlist and album paths with or without the storefront and slug", () => {
    expect(parseAppleLink("https://music.apple.com/us/playlist/morning/pl.abc123")).toEqual({
      storefront: "us",
      kind: "playlist",
      id: "pl.abc123",
      slug: "morning",
    });
    expect(parseAppleLink("https://music.apple.com/GB/album/123")).toEqual({
      storefront: "gb",
      kind: "album",
      id: "123",
      slug: undefined,
    });
    expect(parseAppleLink("https://music.apple.com/playlist/pl.u-AbC9")).toMatchObject({ storefront: "us", id: "pl.u-AbC9" });
  });

  it("refuses songs, artists and malformed ids", () => {
    for (const href of [
      "https://music.apple.com/us/song/x/123",
      "https://music.apple.com/us/album/harbour/123?i=456",
      "https://music.apple.com/us/artist/mira-holt/99",
      "https://music.apple.com/us/playlist/morning/abc",
      "https://music.apple.com/us/album/harbour/12a",
      "https://music.apple.com/us/album/a/b/123",
    ]) {
      expect(parseAppleLink(href), href).toBeNull();
    }
  });
});

describe("listApple", () => {
  it("reads a 3-track playlist page into metadata rows in page order", async () => {
    const fetch = fakeFetch({
      "https://music.apple.com/us/playlist/morning/pl.abc123": html(MORNING),
    });
    const listing = await listApple("https://music.apple.com/us/playlist/morning/pl.abc123", http(fetch));
    expect(listing).toEqual({
      source: "apple-music",
      label: "Morning Light",
      rows: [
        {
          title: "Paper Moons",
          artists: ["Mira Holt"],
          album: "Harbour",
          durationMs: 201_000,
        },
        {
          title: "Glass River",
          artists: ["Nadia Rowe", "Tomas Vey"],
          album: "Northbound",
          durationMs: 187_500,
        },
        {
          title: "Slow Tide",
          artists: [],
          album: "Harbour",
          durationMs: 240_000,
        },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("headers");
  });

  it("leaves a missing artist empty, never a placeholder", async () => {
    const fetch = fakeFetch({
      "https://music.apple.com/us/playlist/pl.abc123": html(MORNING),
    });
    const listing = await listApple("https://music.apple.com/us/playlist/pl.abc123", http(fetch));
    expect(listing.rows[2].artists).toEqual([]);
  });

  it("splits a single artist string and skips tracks without a title", async () => {
    const page = applePage({
      title: "Mixed",
      tracks: [
        { title: "One", artists: ["Mira Holt, Nadia Rowe & Tomas Vey"] },
        { title: "  ", artists: ["Nobody"] },
      ],
    });
    const fetch = fakeFetch({
      "https://music.apple.com/us/playlist/pl.mix": html(page),
    });
    const listing = await listApple("https://music.apple.com/us/playlist/pl.mix", http(fetch));
    expect(listing.rows).toEqual([{ title: "One", artists: ["Mira Holt", "Nadia Rowe", "Tomas Vey"] }]);
  });

  it("puts the album title on every row of an album page", async () => {
    const page = applePage({
      title: "Harbour",
      tracks: [{ title: "Paper Moons", artists: ["Mira Holt"], durationMs: 1_000 }],
    });
    const fetch = fakeFetch({
      "https://music.apple.com/us/album/harbour/123": html(page),
    });
    const listing = await listApple("https://music.apple.com/us/album/harbour/123", http(fetch));
    expect(listing.rows[0].album).toBe("Harbour");
  });

  it("says how many songs the page showed when the playlist is longer", async () => {
    const tracks = Array.from({ length: 100 }, (_, i) => ({
      title: `Song ${i}`,
      artists: ["Mira Holt"],
    }));
    const fetch = fakeFetch({
      "https://music.apple.com/us/playlist/pl.long": html(applePage({ title: "Long", trackCount: 340, tracks })),
    });
    const listing = await listApple("https://music.apple.com/us/playlist/pl.long", http(fetch));
    expect(listing.rows).toHaveLength(100);
    expect(listing.notice).toEqual({ kind: "partial", shown: 100, total: 340 });
  });

  it("retries a 404 once with the us storefront, then fails as gone", async () => {
    const fetch = fakeFetch({});
    const error = await listApple("https://music.apple.com/gb/playlist/pl.abc", http(fetch)).catch((e) => e);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://music.apple.com/gb/playlist/pl.abc", "https://music.apple.com/us/playlist/pl.abc"]);
    expect(error).toEqual(new ImportError("gone"));

    const found = fakeFetch({
      "https://music.apple.com/us/playlist/pl.abc": html(MORNING),
    });
    expect((await listApple("https://music.apple.com/gb/playlist/pl.abc", http(found))).rows).toHaveLength(3);
  });

  it("fails as source_changed when the page data is missing or broken", async () => {
    for (const body of [
      "<html><body>no data</body></html>",
      '<script id="serialized-server-data" type="application/json">{oops</script>',
      '<script id="serialized-server-data">[{"data":{"sections":[]}}]</script>',
    ]) {
      const fetch = fakeFetch({
        "https://music.apple.com/us/playlist/pl.x": html(body),
      });
      await expect(listApple("https://music.apple.com/us/playlist/pl.x", http(fetch))).rejects.toEqual(new ImportError("source_changed"));
    }
  });

  it("refuses a song link without a request", async () => {
    const fetch = fakeFetch({});
    await expect(listApple("https://music.apple.com/us/song/x/123", http(fetch))).rejects.toEqual(new ImportError("bad_link"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a server error to network", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response("", { status: 500 }));
    await expect(listApple("https://music.apple.com/us/playlist/pl.x", http(fetch))).rejects.toEqual(new ImportError("network"));
  });
});

describe("listApple limits", () => {
  it("refuses a page over the size cap as source_changed", async () => {
    const fetch = fakeFetch({
      "https://music.apple.com/us/playlist/pl.big": html("x".repeat(8_100_000)),
    });
    await expect(listApple("https://music.apple.com/us/playlist/pl.big", http(fetch))).rejects.toEqual(new ImportError("source_changed"));
  });

  it("does not throw on a malformed link", () => {
    expect(parseAppleLink("not a url")).toBeNull();
    expect(parseAppleLink("https://music.apple.com/us/album/%E0%A4%A/1")).toBeNull();
  });
});

describe("listApple edge cases", () => {
  const url = "https://music.apple.com/us/playlist/pl.long";
  const listLong = (page: string) => listApple(url, http(fakeFetch({ [url]: html(page) })));

  it("counts the rows it shows, not the entries on the page", async () => {
    const tracks = [...Array.from({ length: 98 }, (_, i) => ({ title: `Song ${i}` })), { title: "" }, { title: "" }];
    const listing = await listLong(applePage({ title: "Long", trackCount: 340, tracks }));
    expect(listing.notice).toEqual({ kind: "partial", shown: 98, total: 340 });
  });

  it("reads a trackCount sent as text", async () => {
    const page = applePage({
      title: "Long",
      tracks: [{ title: "A" }, { title: "B" }],
    }).replace('"trackCount":2', '"trackCount":"340"');
    const listing = await listLong(page);
    expect(listing.notice).toEqual({ kind: "partial", shown: 2, total: 340 });
  });

  it("keeps Cyrillic titles", async () => {
    const listing = await listLong(
      applePage({
        title: "Тёмный лес",
        tracks: [{ title: "Колыбельная", artists: ["Мира Холт"] }],
      }),
    );
    expect(listing.label).toBe("Тёмный лес");
    expect(listing.rows[0]).toMatchObject({
      title: "Колыбельная",
      artists: ["Мира Холт"],
    });
  });

  it("does not take lookalike hosts for Apple Music", () => {
    for (const href of [
      "https://music.apple.com.evil.com/us/playlist/pl.a",
      "https://evil-music.apple.com.example/us/playlist/pl.a",
      "https://notmusic.apple.com/us/playlist/pl.a",
    ]) {
      expect(detectLink(href), href).not.toMatchObject({ kind: "apple-music" });
    }
  });
});
