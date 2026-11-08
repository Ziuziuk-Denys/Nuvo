import { describe, expect, it } from "vitest";
import { importUrl, parseUrl } from "./urls";
import { json } from "../test/fakeFetch";
import { harness, signal } from "../test/harness";
import { browsePage, continuationPage, nextResponse, queueRow, responsiveHeader, run, songRow } from "../test/shapes";

const OEMBED = (id: string) => `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;

describe("parseUrl", () => {
  it("playlists, short links, embeds and short ids", () => {
    expect(parseUrl("https://music.youtube.com/playlist?list=PLshortid123456")).toEqual({
      playlistId: "VLPLshortid123456",
    });
    expect(parseUrl("https://youtu.be/abcDEF12_-x?t=3")).toEqual({
      videoId: "abcDEF12_-x",
    });
    expect(parseUrl("https://www.youtube.com/embed/abcDEF12_-x")).toEqual({
      videoId: "abcDEF12_-x",
    });
    expect(parseUrl("https://youtube.com/watch?v=short")).toBeUndefined();
  });

  it("10.7.5 www.youtube.com is accepted; other hosts and junk are not", () => {
    expect(parseUrl("https://www.youtube.com/watch?v=abcDEF12_-x&list=VLPLyValidPlaylist")).toEqual({
      videoId: "abcDEF12_-x",
      playlistId: "VLPLyValidPlaylist",
    });
    expect(parseUrl("https://evil.example/watch?v=abcDEF12_-x")).toBeUndefined();
    expect(parseUrl("not a url")).toBeUndefined();
  });

  it("requires https; rejects http, javascript:, data:, file:", () => {
    expect(parseUrl("http://www.youtube.com/watch?v=abcDEF12_-x")).toBeUndefined();
    expect(parseUrl("javascript:alert('xss')")).toBeUndefined();
    expect(parseUrl("data:text/html,<script>alert('xss')</script>")).toBeUndefined();
    expect(parseUrl("file:///home/user/file.txt")).toBeUndefined();
  });

  it("rejects URLs with non-default ports", () => {
    expect(parseUrl("https://www.youtube.com:8080/watch?v=abcDEF12_-x")).toBeUndefined();
    expect(parseUrl("https://youtu.be:8080/abcDEF12_-x")).toBeUndefined();
  });

  it("caps total input length to 2048 characters", () => {
    const longId = "x".repeat(2048);
    expect(parseUrl(longId)).toBeUndefined();
    const validUrl = "https://www.youtube.com/watch?v=abcDEF12_-x";
    const longParam = "a".repeat(2000);
    expect(parseUrl(`${validUrl}&param=${longParam}`)).toBeUndefined();
  });

  it("validates list ids against pattern: (VL)?(PL|OLAK5uy_|RD|UU)[\\w-]{10,64}", () => {
    expect(parseUrl("https://www.youtube.com/playlist?list=PLx")).toBeUndefined();
    expect(parseUrl("https://www.youtube.com/playlist?list=PLshortid123456")).toBeDefined();
    expect(parseUrl("https://music.youtube.com/playlist?list=OLAK5uy_nVfQ_O_LmjG5v_m85_rYAXf7KPkV5l84w")).toEqual({
      playlistId: "VLOLAK5uy_nVfQ_O_LmjG5v_m85_rYAXf7KPkV5l84w",
    });
    expect(parseUrl("https://www.youtube.com/watch?v=abcDEF12_-x&list=RDabcDEF12_-xabcde")).toEqual({ videoId: "abcDEF12_-x" });
    expect(parseUrl("https://www.youtube.com/playlist?list=invalid123")).toBeUndefined();
  });

  it("watch URL with RD list (mix) falls back to the video", () => {
    expect(parseUrl("https://www.youtube.com/watch?v=abcDEF12_-x&list=RDabcDEF12_-xab")).toEqual({ videoId: "abcDEF12_-x" });
  });

  it("rejects /shorts/<id> and /live/<id> paths (keep failing closed)", () => {
    expect(parseUrl("https://www.youtube.com/shorts/abcDEF12_-x")).toBeUndefined();
    expect(parseUrl("https://www.youtube.com/live/abcDEF12_-x")).toBeUndefined();
    expect(parseUrl("https://youtu.be/shorts/abcDEF12_-x")).toBeUndefined();
  });

  it("rejects youtube.com.evil.com, youtube.com@evil.com, and punycode lookalikes", () => {
    expect(parseUrl("https://youtube.com.evil.com/watch?v=abcDEF12_-x")).toBeUndefined();
    expect(parseUrl("https://youtube.com@evil.com/watch?v=abcDEF12_-x")).toBeUndefined();
  });

  it("accepts uppercase host and trailing dot but normalizes them", () => {
    expect(parseUrl("https://YOUTUBE.COM/watch?v=abcDEF12_-x")).toEqual({
      videoId: "abcDEF12_-x",
    });
    expect(parseUrl("https://WWW.YOUTUBE.COM/watch?v=abcDEF12_-x")).toEqual({
      videoId: "abcDEF12_-x",
    });
  });

  it("handles m. and www. subdomains", () => {
    expect(parseUrl("https://m.youtube.com/watch?v=abcDEF12_-x")).toEqual({
      videoId: "abcDEF12_-x",
    });
    expect(parseUrl("https://www.youtube.com/watch?v=abcDEF12_-x")).toEqual({
      videoId: "abcDEF12_-x",
    });
  });

  it("rejects youtu.be with 12-char id", () => {
    expect(parseUrl("https://youtu.be/abcDEF12_-xx")).toBeUndefined();
  });

  it("rejects empty v= parameter", () => {
    expect(parseUrl("https://www.youtube.com/watch?v=")).toBeUndefined();
  });

  it("rejects junk list= parameter", () => {
    expect(parseUrl("https://www.youtube.com/watch?v=abcDEF12_-x&list=")).toEqual({
      videoId: "abcDEF12_-x",
    });
  });
});

describe("importUrl", () => {
  const URL_PL = "https://music.youtube.com/playlist?list=PLimpImpImpImp";
  const header = responsiveHeader({
    title: "Imported",
    description: "About it",
  });

  it("a repeated token stops after page two", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(browsePage(header, [songRow({ id: "vidIMP00001", title: "1" })], "same")), (body) => body.browseId === "VLPLimpImpImpImp");
    fake.innertube("browse", json(continuationPage([songRow({ id: "vidIMP00002", title: "2" })], "same")), (body) => body.continuation === "same");
    const list = await importUrl(yt, fake.fetch, URL_PL, signal());
    expect(list.tracks.map((track) => track.ytId)).toEqual(["vidIMP00001", "vidIMP00002"]);
    expect(fake.callsTo("POST", "https://music.youtube.com/youtubei/v1/browse")).toHaveLength(2);
    expect([list.title, list.description, list.source]).toEqual(["Imported", "About it", "youtube"]);
  });

  it("at most 51 browse calls", async () => {
    const { fake, yt } = harness();
    let page = 0;
    fake.innertube("browse", json(browsePage(header, [songRow({ id: "vidSTART000", title: "s" })], "t0")), (body) => body.browseId === "VLPLimpImpImpImp");
    fake.innertube(
      "browse",
      () => {
        page += 1;
        return json(
          continuationPage(
            [
              songRow({
                id: `vid${String(page).padStart(8, "0")}`,
                title: `${page}`,
              }),
            ],
            `t${page}`,
          ),
        );
      },
      (body) => typeof body.continuation === "string",
    );
    const list = await importUrl(yt, fake.fetch, URL_PL, signal());
    expect(fake.callsTo("POST", "https://music.youtube.com/youtubei/v1/browse")).toHaveLength(51);
    expect(list.tracks).toHaveLength(51);
  });

  it("a playlist with no rows is empty-playlist", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(browsePage(header, [])));
    await expect(importUrl(yt, fake.fetch, URL_PL, signal())).rejects.toMatchObject({ code: "empty-playlist" });
  });

  it("a single video: next wins; oEmbed fills in and loses the artist prefix", async () => {
    const id = "abcDEF12_-x";
    const first = harness();
    first.fake.innertube("next", json(nextResponse(queueRow({ id, title: "Song", byline: [run("Artist")] }))));
    first.fake.on(
      "GET",
      OEMBED(id),
      json({
        title: "Artist - Song (Official Video)",
        author_name: "ArtistVEVO",
      }),
    );
    const list = await importUrl(first.yt, first.fake.fetch, `https://youtu.be/${id}`, signal());
    expect(list.tracks).toEqual([
      expect.objectContaining({
        ytId: id,
        title: "Song",
        artistTexts: ["Artist"],
      }),
    ]);

    const second = harness();
    second.fake.innertube("next", json({}, 500));
    second.fake.on("GET", OEMBED(id), json({ title: "Artist - Song", author_name: "Artist" }));
    const fallback = await importUrl(second.yt, second.fake.fetch, `https://www.youtube.com/watch?v=${id}`, signal());
    expect(fallback.tracks[0]).toMatchObject({
      title: "Song",
      artistTexts: ["Artist"],
      coverUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  });

  it("a URL with neither id is bad-url", async () => {
    const { fake, yt } = harness();
    await expect(importUrl(yt, fake.fetch, "https://www.youtube.com/feed/library", signal())).rejects.toMatchObject({ code: "bad-url" });
  });

  it("sourceUrl is a rebuilt canonical URL, never the raw input", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "next",
      json(
        nextResponse(
          queueRow({
            id: "abcDEF12_-x",
            title: "Test",
            byline: [run("Artist")],
          }),
        ),
      ),
    );
    const result = await importUrl(yt, fake.fetch, "https://youtu.be/abcDEF12_-x?t=123&extra=param", signal());
    expect(result.sourceUrl).toBe("https://www.youtube.com/watch?v=abcDEF12_-x");
  });

  it("watch URL with list=RD... (mix) falls back to the video, not the playlist", async () => {
    const { fake, yt } = harness();
    const id = "abcDEF12_-x";
    fake.innertube(
      "next",
      json(
        nextResponse(
          queueRow({
            id,
            title: "Song",
            byline: [run("Artist")],
          }),
        ),
      ),
    );
    const result = await importUrl(yt, fake.fetch, `https://www.youtube.com/watch?v=${id}&list=RDabcDEF12_-xab`, signal());
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].ytId).toBe(id);
  });
});
