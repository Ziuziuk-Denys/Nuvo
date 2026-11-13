import { describe, expect, it } from "vitest";
import { MAX_WEB_LINK, routeLink, type LinkRoute } from "./router";

const kind = (text: string) => routeLink(text)?.kind ?? "search";

describe("not links: a normal search", () => {
  it.each(["queen", "Queen: Bohemian Rhapsody", "AC/DC: Thunderstruck", "mr.kitty after dark", "ver.2", "example.com", "   ", "mailto:a@b.c"])("%s", (text) => {
    expect(routeLink(text)).toBeNull();
  });
});

describe("refused links", () => {
  it.each([
    ["javascript:alert(1)", "invalid_link"],
    ["file:///etc/passwd", "invalid_link"],
    ["ftp://example.com/song.mp3", "invalid_link"],
    ["https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ", "invalid_link"],
    ["https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ", "invalid_link"],
    ["http://127.0.0.1/song", "invalid_link"],
    ["http://localhost:5173/", "invalid_link"],
    ["http://[::1]/x", "invalid_link"],
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=${"a".repeat(MAX_WEB_LINK)}`, "invalid_link"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc", "spotify_file_only"],
    ["https://open.spotify.com/collection/tracks", "spotify_file_only"],
    ["https://open.spotify.com/playlist/short", "spotify_file_only"],
    ["https://vk.com/audio-2001_123", "login_required"],
    ["https://vk.com/music/playlist/-147845620_2", "login_required"],
    ["nuvo://share?id=bad!", "bad_share"],
    ["nuvo://share?id=a&id=b", "bad_share"],
    [`nuvo://share?id=${"A".repeat(65_537)}`, "bad_share"],
    ["nuvo://song?id=dQw4w9WgXcQ", "invalid_link"],
    ["https://www.tiktok.com/@someone", "unsupported"],
    ["https://www.youtube.com/@channel", "unsupported"],
  ])("%s", (text, code) => {
    expect(routeLink(text)).toMatchObject({ kind: "error", code });
  });

  it("a 2,048-character link is still read", () => {
    const base = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=";
    expect(kind(base + "a".repeat(MAX_WEB_LINK - base.length))).toBe("youtube");
  });
});

describe("routes", () => {
  const cases: [string, Partial<LinkRoute>][] = [
    [
      "nuvo://share?id=EAABDCDQmtC40L3QvgnQk9GA0YPQv9C_0LAg0LrRgNC-0LLQuJ8C",
      {
        kind: "share",
        payload: "EAABDCDQmtC40L3QvgnQk9GA0YPQv9C_0LAg0LrRgNC-0LLQuJ8C",
      },
    ],
    ["nuvo://track?id=dQw4w9WgXcQ", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    [`nuvo://artist?id=UC${"a".repeat(22)}`, { kind: "navigate", type: "artist" }],
    ["nuvo://album?id=MPREb_abcd", { kind: "navigate", type: "album", id: "MPREb_abcd" }],
    ["nuvo://playlist?id=PL12345678", { kind: "navigate", type: "playlist" }],
    [
      "https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc",
      {
        kind: "tiktok",
        url: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
      },
    ],
    ["https://m.tiktok.com/v/6718335390845095173.html", { kind: "tiktok" }],
    ["https://vm.tiktok.com/ZSabc123/", { kind: "tiktok" }],
    ["https://vt.tiktok.com/ZSabc123/", { kind: "tiktok" }],
    ["https://www.tiktok.com/t/ZTRabc/", { kind: "tiktok" }],
    ["tiktok.com/@a/photo/7234567890123456789", { kind: "tiktok" }],
    ["https://WWW.TIKTOK.COM/@a/video/7234567890123456789", { kind: "tiktok" }],
    ["https://www.tiktok.com/music/I-Will-Survive-6689804660171082501", { kind: "tiktok-sound", title: "I Will Survive" }],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz",
      {
        kind: "youtube",
        id: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    ],
    ["youtube.com/watch?v=dQw4w9WgXcQ", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefgh", { kind: "youtube", id: "dQw4w9WgXcQ", playlistId: "PLabcdefgh" }],
    ["https://www.youtube.com/playlist?list=PLabcdefgh", { kind: "import", service: "youtube" }],
    ["https://music.youtube.com/browse/MPREb_4pL8gzRtw1p", { kind: "import", service: "youtube" }],
    ["https://soundcloud.com/artist/track-name", { kind: "soundcloud" }],
    ["https://m.soundcloud.com/artist/track-name", { kind: "soundcloud" }],
    ["https://soundcloud.com/artist/sets/summer", { kind: "import", service: "soundcloud" }],
    ["https://soundcloud.com/artist/likes", { kind: "import", service: "soundcloud" }],
    ["https://on.soundcloud.com/AbC12", { kind: "short", service: "soundcloud" }],
    ["https://music.apple.com/us/album/discovery/697194953?i=697195462", { kind: "apple-song", id: "697195462", storefront: "us" }],
    ["https://music.apple.com/gb/song/one-more-time/697195462", { kind: "apple-song", id: "697195462", storefront: "gb" }],
    ["https://music.apple.com/album/discovery/697194953", { kind: "import", service: "apple-music" }],
    ["https://music.apple.com/us/playlist/chill/pl.u-abc123", { kind: "import", service: "apple-music" }],
    ["https://www.deezer.com/en/track/3135556", { kind: "deezer-track", id: "3135556" }],
    ["https://deezer.com/track/3135556", { kind: "deezer-track", id: "3135556" }],
    ["https://www.deezer.com/fr/playlist/908622995", { kind: "import", service: "deezer" }],
    [
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc",
      { kind: "import", service: "spotify", url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" },
    ],
    ["open.spotify.com/intl-de/album/4LH4d3cOWNNsVw41Gqt2kv", { kind: "import", service: "spotify" }],
    ["https://spotify.link/AbCdEf", { kind: "short", service: "spotify" }],
    ["https://deezer.page.link/abc", { kind: "short", service: "deezer" }],
    ["https://link.deezer.com/s/abc", { kind: "short", service: "deezer" }],
    ["https://music.yandex.ru/album/4766/track/57703", { kind: "yandex-track", id: "57703" }],
    ["https://music.yandex.com/track/57703", { kind: "yandex-track", id: "57703" }],
    ["https://music.yandex.ru/album/4766/", { kind: "import", service: "yandex" }],
    ["https://music.yandex.by/users/music-blog/playlists/2393", { kind: "import", service: "yandex" }],
    ["https://music.yandex.ru/playlists/lk.1f8d2c3e-6a7b-4c5d-9e0f-123456789abc", { kind: "import", service: "yandex" }],
    ["https://www.shazam.com/song/1440833098/i-will-survive", { kind: "shazam", id: "1440833098", slug: "i will survive" }],
    ["https://www.shazam.com/track/53982678/i-will-survive", { kind: "shazam", slug: "i will survive" }],
    ["https://www.instagram.com/reel/Cabc123/", { kind: "media", host: "www.instagram.com" }],
    ["https://vk.com/video-1_456", { kind: "media" }],
    ["https://vk.com/audiophile", { kind: "media" }],
  ];

  it.each(cases)("%s", (text, expected) => {
    expect(routeLink(text)).toMatchObject(expected);
  });

  it("a whole pasted share message opens its link", () => {
    expect(routeLink("Rick Astley - Never Gonna Give You Up\nOpen in Nuvo: nuvo://share?id=EAAB_x-9\nhttps://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "share",
      payload: "EAAB_x-9",
    });
    expect(routeLink("see nuvo://share?id=bad!")).toMatchObject({
      kind: "error",
      code: "bad_share",
    });
  });

  it("look-alike hosts are not the services they imitate", () => {
    expect(routeLink("https://notsoundcloud.com/a/b")).toMatchObject({
      kind: "media",
      host: "notsoundcloud.com",
    });
    expect(routeLink("https://tiktok.com.evil.io/@a/video/7234567890123456789")).toMatchObject({ kind: "media", host: "tiktok.com.evil.io" });
    expect(routeLink("notsoundcloud.com/a/b")).toBeNull();
  });
});
