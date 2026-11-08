import { describe, expect, it, vi } from "vitest";
import { MAX_DEEZER_REQUESTS, isDeezerShortLink, listDeezer, parseDeezerLink } from "./deezer";
import { detectLink } from "./detect";
import { deezerTracks } from "./fixtures/deezer";
import type { FetchLike } from "./http";
import { ImportError } from "./types";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function fakeFetch(answers: Record<string, unknown>) {
  return vi.fn<FetchLike>(async (url) => {
    if (!(url in answers)) return new Response("", { status: 404 });
    const answer = answers[url];
    return answer instanceof Response ? answer : json(answer);
  });
}

const http = (fetch: FetchLike, signal = new AbortController().signal) => ({
  fetch,
  sleep: async () => {},
  signal,
});
const API = "https://api.deezer.com/";

describe("parseDeezerLink", () => {
  it("accepts playlist and album paths with or without a language", () => {
    expect(parseDeezerLink("https://www.deezer.com/en/playlist/908622995")).toEqual({ kind: "playlist", id: "908622995" });
    expect(parseDeezerLink("https://deezer.com/album/302127")).toEqual({
      kind: "album",
      id: "302127",
    });
    expect(parseDeezerLink("https://www.deezer.com/pt-br/album/302127")).toEqual({ kind: "album", id: "302127" });
  });

  it("refuses tracks, artists and odd ids", () => {
    for (const href of [
      "https://www.deezer.com/en/track/3135556",
      "https://www.deezer.com/artist/27",
      "https://www.deezer.com/playlist/abc",
      "https://www.deezer.com/en/x/playlist/1",
    ]) {
      expect(parseDeezerLink(href), href).toBeNull();
    }
  });
});

describe("listDeezer", () => {
  it("follows next pages in order, durations in ms", async () => {
    const answers: Record<string, unknown> = {
      [`${API}playlist/1`]: {
        title: "Northbound",
        nb_tracks: 250,
        tracks: {
          data: deezerTracks(0, 25),
          next: `${API}playlist/1/tracks?index=25`,
        },
      },
    };
    for (let index = 25; index < 250; index += 25) {
      answers[`${API}playlist/1/tracks?index=${index}`] = {
        data: deezerTracks(index, 25),
        ...(index + 25 < 250 ? { next: `${API}playlist/1/tracks?index=${index + 25}` } : {}),
      };
    }
    const progress: number[] = [];
    const listing = await listDeezer("https://www.deezer.com/en/playlist/1", http(fakeFetch(answers)), (n) => progress.push(n));
    expect(listing.label).toBe("Northbound");
    expect(listing.rows).toHaveLength(250);
    expect(listing.rows[0]).toEqual({
      title: "Song 0",
      artists: ["Mira Holt"],
      album: "Northbound",
      durationMs: 180_000,
    });
    expect(listing.rows.map((r) => r.title)).toEqual(Array.from({ length: 250 }, (_, i) => `Song ${i}`));
    expect(progress.at(-1)).toBe(250);
  });

  it("fills the rest with index paging and stops on a page that adds nothing", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/2`]: {
        title: "Long",
        nb_tracks: 250,
        tracks: {
          data: deezerTracks(0, 100),
          next: `${API}playlist/2/tracks?index=100`,
        },
      },
      [`${API}playlist/2/tracks?index=100`]: { data: deezerTracks(100, 80) },
      [`${API}playlist/2/tracks?limit=100&index=180`]: {
        data: deezerTracks(180, 50),
      },
      [`${API}playlist/2/tracks?limit=100&index=230`]: { data: [] },
    });
    const listing = await listDeezer("https://deezer.com/playlist/2", http(fetch));
    expect(listing.rows).toHaveLength(230);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(listing.notice).toEqual({ kind: "partial", shown: 230, total: 250 });
  });

  it("keeps the rows of the pages read when a later page fails", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/3`]: {
        title: "Long",
        nb_tracks: 300,
        tracks: { data: deezerTracks(0, 100), next: `${API}playlist/3/tracks?index=100` },
      },
      [`${API}playlist/3/tracks?index=100`]: new Response("", { status: 500 }),
    });
    const listing = await listDeezer("https://deezer.com/playlist/3", http(fetch));
    expect(listing.rows).toHaveLength(100);
    expect(listing.notice).toEqual({ kind: "partial", shown: 100, total: 300 });
  });

  it("treats an error object in an HTTP 200 answer as gone", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/3`]: {
        error: { type: "DataException", message: "no data", code: 800 },
      },
    });
    await expect(listDeezer("https://deezer.com/playlist/3", http(fetch))).rejects.toEqual(new ImportError("gone"));
  });

  it("treats a quota error as network", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/3`]: {
        error: { type: "Exception", message: "Quota limit exceeded", code: 4 },
      },
    });
    await expect(listDeezer("https://deezer.com/playlist/3", http(fetch))).rejects.toEqual(new ImportError("network"));
  });

  it("puts the album title on every row of an album", async () => {
    const tracks = deezerTracks(0, 2).map(({ album: _album, ...track }) => track);
    const fetch = fakeFetch({
      [`${API}album/9`]: {
        title: "Harbour",
        nb_tracks: 2,
        tracks: { data: tracks },
      },
    });
    const listing = await listDeezer("https://www.deezer.com/fr/album/9", http(fetch));
    expect(listing.rows.map((r) => r.album)).toEqual(["Harbour", "Harbour"]);
  });

  it("follows a short link to the playlist it names", async () => {
    const redirected = json({});
    Object.defineProperty(redirected, "url", {
      value: "https://www.deezer.com/en/playlist/4?utm_source=share",
    });
    const fetch = fakeFetch({
      "https://deezer.page.link/AbC": redirected,
      [`${API}playlist/4`]: {
        title: "Shared",
        nb_tracks: 1,
        tracks: { data: deezerTracks(0, 1) },
      },
    });
    const listing = await listDeezer("https://deezer.page.link/AbC", http(fetch));
    expect(listing.rows).toHaveLength(1);
  });

  it("refuses a short link that lands anywhere but a Deezer playlist or album", async () => {
    const elsewhere = json({});
    Object.defineProperty(elsewhere, "url", {
      value: "https://evil.example/playlist/4",
    });
    const fetch = fakeFetch({ "https://link.deezer.com/s/x": elsewhere });
    await expect(listDeezer("https://link.deezer.com/s/x", http(fetch))).rejects.toEqual(new ImportError("bad_link"));
  });

  it("ignores a next link to another host", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/5`]: {
        title: "T",
        nb_tracks: 50,
        tracks: {
          data: deezerTracks(0, 25),
          next: "https://evil.example/next",
        },
      },
      [`${API}playlist/5/tracks?limit=100&index=25`]: { data: [] },
    });
    const listing = await listDeezer("https://deezer.com/playlist/5", http(fetch));
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain("https://evil.example/next");
    expect(listing.rows).toHaveLength(25);
  });

  it("stops after the request budget", async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url === `${API}playlist/6`
        ? json({
            title: "Huge",
            nb_tracks: 100_000,
            tracks: { data: deezerTracks(0, 1) },
          })
        : json({ data: deezerTracks(0, 1) }),
    );
    const listing = await listDeezer("https://deezer.com/playlist/6", http(fetch));
    expect(fetch).toHaveBeenCalledTimes(MAX_DEEZER_REQUESTS);
    expect(listing.rows).toHaveLength(MAX_DEEZER_REQUESTS);
    expect(listing.notice).toEqual({
      kind: "partial",
      shown: MAX_DEEZER_REQUESTS,
      total: 100_000,
    });
  });

  it("makes no further request after cancel", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<FetchLike>(async (url) => {
      if (url.endsWith("index=50")) controller.abort(new DOMException("cancelled", "AbortError"));
      if (url === `${API}playlist/7`)
        return json({
          title: "T",
          nb_tracks: 500,
          tracks: {
            data: deezerTracks(0, 25),
            next: `${API}playlist/7/tracks?index=25`,
          },
        });
      const index = Number(new URL(url).searchParams.get("index"));
      return json({
        data: deezerTracks(index, 25),
        next: `${API}playlist/7/tracks?index=${index + 25}`,
      });
    });
    const error = await listDeezer("https://deezer.com/playlist/7", http(fetch, controller.signal)).catch((e) => e);
    expect((error as DOMException).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("listDeezer limits", () => {
  it("treats an oversized answer as network", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/8`]: new Response("x".repeat(2_100_000)),
    });
    await expect(listDeezer("https://deezer.com/playlist/8", http(fetch))).rejects.toEqual(new ImportError("network"));
  });

  it("treats a body that is not JSON as network", async () => {
    const fetch = fakeFetch({ [`${API}playlist/8`]: new Response("<html>") });
    await expect(listDeezer("https://deezer.com/playlist/8", http(fetch))).rejects.toEqual(new ImportError("network"));
  });

  it("does not throw on a malformed link", () => {
    expect(parseDeezerLink("not a url")).toBeNull();
  });
});

describe("listDeezer edge cases", () => {
  it("treats a string error in an HTTP 200 answer as an error, not an empty listing", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/3`]: { error: "Quota limit exceeded" },
    });
    await expect(listDeezer("https://deezer.com/playlist/3", http(fetch))).rejects.toEqual(new ImportError("network"));
  });

  it("keeps Cyrillic titles and artists", async () => {
    const fetch = fakeFetch({
      [`${API}playlist/7`]: {
        title: "Тёмный лес",
        nb_tracks: 1,
        tracks: {
          data: [
            {
              title: "Колыбельная",
              duration: 100,
              artist: { name: "Мира Холт" },
            },
          ],
        },
      },
    });
    const listing = await listDeezer("https://deezer.com/playlist/7", http(fetch));
    expect(listing.label).toBe("Тёмный лес");
    expect(listing.rows[0]).toMatchObject({
      title: "Колыбельная",
      artists: ["Мира Холт"],
    });
    expect(listing.notice).toBeUndefined();
  });

  it("recognises a short-link host with a trailing dot", () => {
    expect(isDeezerShortLink("https://link.deezer.com./abc")).toBe(true);
    expect(isDeezerShortLink("https://deezer.page.link./abc")).toBe(true);
  });

  it("does not take lookalike hosts for Deezer", () => {
    for (const href of ["https://evil-deezer.com/playlist/1", "https://deezer.com.evil.com/playlist/1"]) {
      expect(detectLink(href), href).toMatchObject({
        error: "unsupported_host",
      });
    }
    expect(isDeezerShortLink("https://evil.link.deezer.com/x")).toBe(false);
    expect(isDeezerShortLink("https://link.deezer.com.evil.com/x")).toBe(false);
  });
});
