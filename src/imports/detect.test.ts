import { describe, expect, it } from "vitest";
import { detectLink, hostMatches } from "./detect";

describe("detectLink", () => {
  it("reads a link without a scheme as https", () => {
    expect(detectLink("  music.apple.com/us/playlist/morning/pl.abc123 ")).toEqual({
      kind: "apple-music",
      url: "https://music.apple.com/us/playlist/morning/pl.abc123",
    });
  });

  it("maps every host of the table", () => {
    const cases: [string, string][] = [
      ["https://www.youtube.com/playlist?list=PL1", "youtube"],
      ["https://music.youtube.com/playlist?list=PL1", "youtube"],
      ["https://m.youtube.com/watch?v=abcdefghijk", "youtube"],
      ["https://youtu.be/abcdefghijk", "youtube"],
      ["https://soundcloud.com/nightowl/sets/late", "soundcloud"],
      ["https://m.soundcloud.com/nightowl/likes", "soundcloud"],
      ["https://on.soundcloud.com/AbC12", "soundcloud"],
      ["https://music.apple.com/gb/album/paper/123", "apple-music"],
      ["https://geo.music.apple.com/us/album/paper/123", "apple-music"],
      ["https://itunes.apple.com/us/album/paper/123", "apple-music"],
      ["https://www.deezer.com/en/playlist/908622995", "deezer"],
      ["https://deezer.com/playlist/908622995", "deezer"],
      ["https://deezer.page.link/AbC", "deezer"],
      ["https://link.deezer.com/s/AbC", "deezer"],
      ["https://open.spotify.com/playlist/37i9dQZF1DX", "spotify"],
      ["https://spotify.link/AbC", "spotify"],
      ["https://music.yandex.ru/users/someone/playlists/3", "yandex-music"],
      ["https://vk.com/music/playlist/-147845620_2", "vk"],
    ];
    for (const [text, kind] of cases) {
      expect(detectLink(text), text).toMatchObject({ kind });
    }
    expect(detectLink("https://notsoundcloud.com/x")).toEqual({
      error: "unsupported_host",
      host: "notsoundcloud.com",
    });
    expect(detectLink("https://vk.com/video-1_456")).toEqual({
      error: "unsupported_host",
      host: "vk.com",
    });
  });

  it("refuses text that is not an http link", () => {
    for (const text of ["ftp://deezer.com/playlist/1", "hello there", "", "   ", "javascript:alert(1)", "localhost"]) {
      expect(detectLink(text), text).toEqual({ error: "not_a_link" });
    }
  });

  it("refuses credentials, ports and overlong text", () => {
    expect(detectLink("https://user:pw@deezer.com/playlist/1")).toEqual({
      error: "not_a_link",
    });
    expect(detectLink("https://deezer.com:8443/playlist/1")).toEqual({
      error: "not_a_link",
    });
    expect(detectLink(`https://deezer.com/playlist/${"1".repeat(2_100)}`)).toEqual({ error: "not_a_link" });
    expect(detectLink("http://127.0.0.1/playlist/1")).toEqual({
      error: "unsupported_host",
      host: "127.0.0.1",
    });
  });

  it("drops the fragment and keeps the query", () => {
    expect(detectLink("https://music.youtube.com/playlist?list=PL1#top")).toEqual({
      kind: "youtube",
      url: "https://music.youtube.com/playlist?list=PL1",
    });
  });

  it("matches a domain only on a dot boundary", () => {
    expect(hostMatches("on.soundcloud.com", "soundcloud.com")).toBe(true);
    expect(hostMatches("notsoundcloud.com", "soundcloud.com")).toBe(false);
  });
});
