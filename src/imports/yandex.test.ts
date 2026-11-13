import { describe, expect, it, vi } from "vitest";
import album from "./fixtures/yandex/album.json";
import notFound from "./fixtures/yandex/not-found.json";
import playlistIdsOnly from "./fixtures/yandex/playlist-ids-only.json";
import playlist from "./fixtures/yandex/playlist.json";
import regionBlocked from "./fixtures/yandex/region-blocked-451.json";
import track from "./fixtures/yandex/track.json";
import tracks from "./fixtures/yandex/tracks.json";
import { detectLink } from "./detect";
import type { FetchLike } from "./http";
import { ImportError } from "./types";
import { YANDEX_API, listYandex, parseYandexLink } from "./yandex";

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(answers: Record<string, unknown>) {
  return vi.fn<FetchLike>(async (url) => {
    const path = url.slice(YANDEX_API.length);
    if (!url.startsWith(YANDEX_API) || !(path in answers)) return new Response("", { status: 404 });
    const body = answers[path];
    return body instanceof Response ? body : answer(body);
  });
}

const http = (fetch: FetchLike) => ({ fetch, sleep: async () => {}, signal: new AbortController().signal });

const rows = [
  { title: "Группа крови", artists: ["Кино"], album: "Группа крови", durationMs: 286000 },
  { title: "Never Gonna Give You Up", artists: ["Rick Astley"], album: "Whenever You Need Somebody", durationMs: 212740 },
  { title: "I Am The Walrus (Remastered 2009)", artists: ["The Beatles"], durationMs: 275000 },
];

describe("parseYandexLink", () => {
  it("reads playlist, shared playlist, album and track paths on every Yandex domain", () => {
    expect(parseYandexLink("https://music.yandex.ru/users/music-blog/playlists/2393?utm_source=x")).toEqual({
      kind: "playlist",
      owner: "music-blog",
      id: "2393",
    });
    expect(parseYandexLink("https://music.yandex.kz/playlists/lk.1f8d2c3e-6a7b-4c5d")).toEqual({ kind: "shared-playlist", id: "lk.1f8d2c3e-6a7b-4c5d" });
    expect(parseYandexLink("https://music.yandex.com/album/4766")).toEqual({ kind: "album", id: "4766" });
    expect(parseYandexLink("https://music.yandex.by/album/4766/track/38634572")).toEqual({ kind: "track", id: "38634572" });
    expect(parseYandexLink("https://music.yandex.ru/track/38634572")).toEqual({ kind: "track", id: "38634572" });
  });

  it("refuses other pages and odd ids", () => {
    for (const href of [
      "https://music.yandex.ru/artist/41",
      "https://music.yandex.ru/users/a/playlists/x",
      "https://music.yandex.ru/users/a%2Fb/playlists/3",
      "https://music.yandex.ru/playlists/..",
      "https://music.yandex.ru/album/1/track/x",
      "https://music.yandex.ru/home",
    ]) {
      expect(parseYandexLink(href), href).toBeNull();
    }
  });

  it("is reached from the link detector", () => {
    expect(detectLink("music.yandex.ru/users/music-blog/playlists/2393")).toEqual({
      kind: "yandex-music",
      url: "https://music.yandex.ru/users/music-blog/playlists/2393",
    });
  });
});

describe("listYandex", () => {
  it("reads a public playlist with its title, versions and lengths", async () => {
    const fetch = fakeFetch({ "users/music-blog/playlists/2393": playlist });
    const progress = vi.fn();
    const listing = await listYandex("https://music.yandex.ru/users/music-blog/playlists/2393", http(fetch), progress);
    expect(listing).toEqual({ source: "yandex-music", label: "Вечные хиты", rows });
    expect(progress).toHaveBeenLastCalledWith(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });

  it("fetches the tracks a playlist lists only by id, in playlist order", async () => {
    const fetch = fakeFetch({ "users/music-blog/playlists/2393": playlistIdsOnly, "tracks?track-ids=38634572,27373847": tracks });
    const listing = await listYandex("https://music.yandex.ru/users/music-blog/playlists/2393", http(fetch));
    expect(listing.rows).toEqual(rows);
  });

  it("keeps what it has when the id lookup stops answering after some songs", async () => {
    const embedded = playlist.result.tracks[1];
    const long = { result: { title: "Long", trackCount: 150, tracks: [...Array(100).fill(embedded), ...Array(50).fill({ id: 38634572 })] } };
    const fetch = fakeFetch({ "users/a/playlists/3": long });
    const listing = await listYandex("https://music.yandex.ru/users/a/playlists/3", http(fetch));
    expect(listing.rows).toHaveLength(100);
    expect(listing.notice).toEqual({ kind: "cut", kept: 100 });
  });

  it("fails when the id lookup fails before any song is read", async () => {
    const fetch = fakeFetch({ "users/music-blog/playlists/2393": playlistIdsOnly });
    await expect(listYandex("https://music.yandex.ru/users/music-blog/playlists/2393", http(fetch))).rejects.toEqual(new ImportError("gone"));
  });

  it("reads a shared playlist link", async () => {
    const fetch = fakeFetch({ "playlist/lk.1f8d": playlist });
    expect((await listYandex("https://music.yandex.ru/playlists/lk.1f8d", http(fetch))).rows).toEqual(rows);
  });

  it("reads every volume of an album with the album title", async () => {
    const fetch = fakeFetch({ "albums/4766/with-tracks": album });
    const listing = await listYandex("https://music.yandex.ru/album/4766", http(fetch));
    expect(listing.label).toBe("Группа крови");
    expect(listing.rows.map((row) => [row.title, row.album])).toEqual([
      ["Группа крови", "Группа крови"],
      ["Закрой за мной дверь, я ухожу", "Группа крови"],
      ["Война", "Группа крови"],
    ]);
  });

  it("reads a single track link as a one-song list", async () => {
    const fetch = fakeFetch({ "tracks/38634572": track });
    expect(await listYandex("https://music.yandex.ru/album/4766/track/38634572", http(fetch))).toEqual({
      source: "yandex-music",
      label: "Группа крови",
      rows: [rows[0]],
    });
  });

  it("explains the region block, a missing list and a broken answer", async () => {
    const blocked = fakeFetch({ "users/a/playlists/3": answer(regionBlocked, 451) });
    await expect(listYandex("https://music.yandex.ru/users/a/playlists/3", http(blocked))).rejects.toEqual(new ImportError("region_blocked"));
    const blockedInBody = fakeFetch({ "users/a/playlists/3": regionBlocked });
    await expect(listYandex("https://music.yandex.ru/users/a/playlists/3", http(blockedInBody))).rejects.toEqual(new ImportError("region_blocked"));
    const missing = fakeFetch({ "albums/999999999/with-tracks": answer(notFound, 404) });
    await expect(listYandex("https://music.yandex.ru/album/999999999", http(missing))).rejects.toEqual(new ImportError("gone"));
    const missingInBody = fakeFetch({ "albums/999999999/with-tracks": notFound });
    await expect(listYandex("https://music.yandex.ru/album/999999999", http(missingInBody))).rejects.toEqual(new ImportError("gone"));
    const broken = fakeFetch({ "albums/1/with-tracks": new Response("<html>", { status: 200 }) });
    await expect(listYandex("https://music.yandex.ru/album/1", http(broken))).rejects.toEqual(new ImportError("network"));
    const odd = fakeFetch({
      "albums/1/with-tracks": { result: { title: 5, volumes: [[{ title: "" }, null, { title: "Ok", artists: "x", durationMs: -1 }]] } },
    });
    expect((await listYandex("https://music.yandex.ru/album/1", http(odd))).rows).toEqual([{ title: "Ok", artists: [] }]);
    await expect(listYandex("https://music.yandex.ru/artist/41", http(odd))).rejects.toEqual(new ImportError("bad_link"));
  });

  it("refuses an answer over the size cap", async () => {
    const huge = fakeFetch({ "albums/1/with-tracks": new Response("x".repeat(32_000_001), { status: 200 }) });
    await expect(listYandex("https://music.yandex.ru/album/1", http(huge))).rejects.toEqual(new ImportError("network"));
  });
});
