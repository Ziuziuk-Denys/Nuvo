import { describe, expect, it, vi } from "vitest";
import { CoreError } from "./core";
import { FakeDaemon, summary } from "./fixtures/fakeDaemon";
import { MORNING } from "./fixtures/apple";
import { deezerTracks } from "./fixtures/deezer";
import { importFile, importFromLink, importSoundCloudLikes, labelOf, listLink, postListing, POST_PAGE_ROWS, soundcloudLikesUrl, throttle } from "./flow";
import type { FetchLike } from "./http";
import { ImportError, MAX_ROWS, type Listing } from "./types";
import type { YoutubeImportedList, YoutubeLister } from "./youtube";

const labels = {
  fallback: (source: string) => `default:${source}`,
  likes: (name: string) => `${name}: Likes`,
};

function setup(pages: Record<string, string | object> = {}, youtube?: YoutubeImportedList | Error) {
  const daemon = new FakeDaemon();
  const fetch = vi.fn<FetchLike>(async (url) => {
    if (!(url in pages)) return new Response("", { status: 404 });
    const page = pages[url];
    return new Response(typeof page === "string" ? page : JSON.stringify(page), { status: 200 });
  });
  const lister: YoutubeLister = {
    importUrl: vi.fn(async () => {
      if (!youtube) throw Object.assign(new Error("bad"), { code: "bad-url" });
      if (youtube instanceof Error) throw youtube;
      return youtube;
    }),
  };
  const started = vi.fn();
  return {
    daemon,
    fetch,
    lister,
    started,
    ports: {
      fetch,
      sleep: async () => {},
      youtube: lister,
      daemon,
      labels,
      started,
    },
  };
}

const signal = () => new AbortController().signal;

describe("importFromLink", () => {
  it("posts a Spotify playlist the daemon read, with the partial notice of a long one", async () => {
    const { ports, fetch, daemon } = setup();
    const url = "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U?si=x";
    daemon.spotify.set(url, {
      source: "spotify",
      label: "Rock Classics",
      rows: [{ title: "Dreams - 2004 Remaster", artists: ["Fleetwood Mac"], durationMs: 257_800 }],
      notice: { kind: "partial", shown: 1, total: 200 },
    });
    const { listing } = await importFromLink(url, ports, { signal: signal() });
    expect(listing.notice).toEqual({ kind: "partial", shown: 1, total: 200 });
    expect(daemon.started[0]).toMatchObject({ source: "spotify", label: "Rock Classics" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps Spotify's Liked songs, tracks and profiles on the export file, without any request", async () => {
    const { ports, fetch, daemon } = setup();
    for (const url of [
      "https://open.spotify.com/collection/tracks",
      "https://open.spotify.com/track/3zOYmiNOuyDL0ClxJcEJ0T",
      "https://open.spotify.com/user/x",
    ]) {
      await expect(listLink(url, ports, signal())).rejects.toEqual(new ImportError("spotify_file_only"));
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(daemon.started).toEqual([]);
  });

  it("maps the daemon's Spotify answers to import errors", async () => {
    const { ports, daemon } = setup();
    const link = (n: number) => `https://open.spotify.com/intl-de/album/4LH4d3cOWNNsVw41Gqt2k${n}`;
    daemon.spotify.set(link(1), new CoreError(400, "INVALID_INPUT"));
    daemon.spotify.set(link(2), new CoreError(502, "SOURCE_CHANGED"));
    daemon.spotify.set(link(3), new CoreError(429, "RATE_LIMITED"));
    daemon.spotify.set("https://spotify.link/abc", new CoreError(504, "UPSTREAM_TIMEOUT"));
    await expect(listLink(link(1), ports, signal())).rejects.toEqual(new ImportError("bad_link"));
    await expect(listLink(link(2), ports, signal())).rejects.toEqual(new ImportError("source_changed"));
    await expect(listLink(link(3), ports, signal())).rejects.toEqual(new ImportError("network"));
    await expect(listLink(link(4), ports, signal())).rejects.toEqual(new ImportError("gone"));
    await expect(listLink("https://spotify.link/abc", ports, signal())).rejects.toEqual(new ImportError("network"));
  });

  it("refuses Yandex Music lists and VK Music with their own codes", async () => {
    const { ports, fetch } = setup();
    await expect(listLink("https://music.yandex.ru/users/a/playlists/3", ports, signal())).rejects.toEqual(new ImportError("yandex_lists"));
    await expect(listLink("https://vk.com/music/playlist/-1_2", ports, signal())).rejects.toEqual(new ImportError("login_required"));
    await expect(listLink("https://example.org/x", ports, signal())).rejects.toEqual(new ImportError("unsupported_host", "example.org"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts one Apple Music import with the title as label and starts its workers", async () => {
    const { ports, daemon, started } = setup({
      "https://music.apple.com/us/playlist/morning/pl.abc123": MORNING,
    });
    const { summaries } = await importFromLink("music.apple.com/us/playlist/morning/pl.abc123", ports, { signal: signal() });
    expect(daemon.started).toHaveLength(1);
    expect(daemon.started[0]).toMatchObject({
      source: "apple-music",
      label: "Morning Light",
    });
    expect((daemon.started[0] as { rows: unknown[] }).rows).toHaveLength(3);
    expect(daemon.started[0]).not.toHaveProperty("target");
    expect(summaries).toEqual([summary("i1")]);
    expect(started).toHaveBeenCalledWith([summary("i1")]);
  });

  it("posts a long listing in pages and keeps the pages posted when one fails", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ title: `S${i}`, artists: ["A"] }));
    const listing: Listing = { source: "deezer", label: "Long", rows };
    const { ports, daemon, started } = setup();
    await postListing(listing, undefined, ports);
    expect((daemon.started[0] as { rows: unknown[] }).rows).toHaveLength(POST_PAGE_ROWS);
    expect(daemon.appended.map((page) => page.rows.length)).toEqual([500, 200]);
    expect(daemon.appended[0].id).toBe("i1");

    const broken = setup();
    broken.daemon.failAppendFrom = 1;
    await expect(postListing(listing, undefined, broken.ports)).rejects.toEqual(new ImportError("cut"));
    expect(broken.started).toHaveBeenCalledTimes(1);
    expect(broken.daemon.appended).toHaveLength(1);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("passes a liked or playlist target through", async () => {
    const { ports, daemon } = setup({
      "https://music.apple.com/us/playlist/pl.abc123": MORNING,
    });
    await importFromLink("https://music.apple.com/us/playlist/pl.abc123", ports, { signal: signal(), target: { kind: "playlist", id: "p9" } });
    expect(daemon.started[0]).toMatchObject({
      target: { kind: "playlist", id: "p9" },
    });
  });

  it("posts nothing when listing is cancelled", async () => {
    const controller = new AbortController();
    const { ports, daemon, fetch } = setup();
    fetch.mockImplementation(async () => {
      controller.abort(new DOMException("cancelled", "AbortError"));
      return new Response(
        JSON.stringify({
          title: "T",
          nb_tracks: 2,
          tracks: { data: deezerTracks(0, 2) },
        }),
      );
    });
    const error = await importFromLink("https://deezer.com/playlist/1", ports, {
      signal: controller.signal,
    }).catch((e) => e);
    expect((error as DOMException).name).toBe("AbortError");
    expect(daemon.started).toEqual([]);
  });

  it("lists a YouTube playlist as Exact rows", async () => {
    const list: YoutubeImportedList = {
      title: "Late drive",
      tracks: ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((ytId, i) => ({
        ytId,
        title: `Song ${i}`,
        artistTexts: ["Mira Holt"],
        artistChannelIds: ["UC1"],
        durationMs: 200_000,
        coverUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      })),
    };
    const { ports, daemon } = setup({}, list);
    await importFromLink("https://music.youtube.com/playlist?list=PL1", ports, {
      signal: signal(),
    });
    const body = daemon.started[0] as {
      source: string;
      rows: { track?: { id: string; artists: unknown[] } }[];
    };
    expect(body.source).toBe("youtube-music");
    expect(body.rows.map((r) => r.track?.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
    expect(body.rows[0].track?.artists).toEqual([{ id: "UC1", name: "Mira Holt" }]);
  });

  it("keeps the YouTube client's cleaned title for a single video", async () => {
    const list: YoutubeImportedList = {
      title: "Paper Moons",
      tracks: [
        {
          ytId: "ddddddddddd",
          title: "Paper Moons",
          artistTexts: ["Mira Holt"],
          artistChannelIds: [],
          coverUrl: "",
        },
      ],
    };
    const { ports, daemon } = setup({}, list);
    await importFromLink("https://youtu.be/ddddddddddd", ports, {
      signal: signal(),
    });
    expect(daemon.started[0]).toMatchObject({
      label: "Paper Moons",
      rows: [
        {
          title: "Paper Moons",
          artists: ["Mira Holt"],
          track: { id: "ddddddddddd" },
        },
      ],
    });
  });

  it("maps a private YouTube playlist to login_required and an empty one to empty", async () => {
    const privateList = setup({}, Object.assign(new Error("x"), { code: "sign-in-required" }));
    await expect(listLink("https://music.youtube.com/playlist?list=PL1", privateList.ports, signal())).rejects.toEqual(new ImportError("login_required"));
    const empty = setup({}, Object.assign(new Error("x"), { code: "empty-playlist" }));
    await expect(listLink("https://music.youtube.com/playlist?list=PL1", empty.ports, signal())).rejects.toEqual(new ImportError("empty"));
  });

  it("reads SoundCloud likes from a name and labels them", async () => {
    const { ports, daemon } = setup();
    daemon.soundcloud.set("https://soundcloud.com/nightowl/likes", {
      source: "soundcloud",
      label: "nightowl",
      likesOf: "nightowl",
      rows: [{ title: "Paper Moons", artists: ["Mira Holt"] }],
    });
    await importSoundCloudLikes("@nightowl", ports, { signal: signal() });
    expect(daemon.started[0]).toMatchObject({
      source: "soundcloud",
      label: "nightowl: Likes",
    });
    await expect(importSoundCloudLikes("  ", ports, { signal: signal() })).rejects.toEqual(new ImportError("missing_name"));
  });

  it("accepts a SoundCloud link in the likes field and refuses odd names", () => {
    expect(soundcloudLikesUrl("https://soundcloud.com/nightowl/likes")).toBe("https://soundcloud.com/nightowl/likes");
    expect(soundcloudLikesUrl("night_owl-2")).toBe("https://soundcloud.com/night_owl-2/likes");
    expect(() => soundcloudLikesUrl("night owl/../x")).toThrow(ImportError);
  });

  it("maps SoundCloud listing errors", async () => {
    const { ports, daemon } = setup();
    daemon.soundcloud.set("https://soundcloud.com/a/sets/b", new CoreError(400, "INVALID_INPUT"));
    await expect(listLink("https://soundcloud.com/a/sets/b", ports, signal())).rejects.toEqual(new ImportError("bad_link"));
    await expect(listLink("https://soundcloud.com/a/sets/c", ports, signal())).rejects.toEqual(new ImportError("gone"));
  });

  it("fails as empty when the source lists no rows", async () => {
    const { ports } = setup({
      "https://api.deezer.com/playlist/1": {
        title: "T",
        nb_tracks: 0,
        tracks: { data: [] },
      },
    });
    await expect(listLink("https://deezer.com/playlist/1", ports, signal())).rejects.toEqual(new ImportError("empty"));
  });

  it("shows the unlock hint when the daemon is locked", async () => {
    const { ports, daemon, started } = setup({
      "https://music.apple.com/us/playlist/pl.abc123": MORNING,
    });
    daemon.startAnswer = new CoreError(423, "LOCKED");
    await expect(
      importFromLink("https://music.apple.com/us/playlist/pl.abc123", ports, {
        signal: signal(),
      }),
    ).rejects.toEqual(new ImportError("locked"));
    expect(started).not.toHaveBeenCalled();
  });
});

describe("listing rules", () => {
  it("cuts a listing at the row cap and says so", async () => {
    const tracks = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({
      ytId: `id${i}`,
      title: "t",
      artistTexts: [],
      artistChannelIds: [],
      coverUrl: "",
    }));
    const { ports } = setup({}, { title: "Huge", tracks });
    const listing = await listLink("https://music.youtube.com/playlist?list=PL1", ports, signal());
    expect(listing.rows).toHaveLength(MAX_ROWS);
    expect(listing.notice).toEqual({ kind: "capped", kept: MAX_ROWS });
  });

  it("always ends with the final row count, also when the listing was cut", async () => {
    const tracks = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({
      ytId: `id${i}`,
      title: "t",
      artistTexts: [],
      artistChannelIds: [],
      coverUrl: "",
    }));
    const { ports } = setup({}, { title: "Huge", tracks });
    const seen: number[] = [];
    await listLink("https://music.youtube.com/playlist?list=PL1", ports, signal(), (count) => seen.push(count));
    expect(seen.at(-1)).toBe(MAX_ROWS);
  });

  it("names a listing by its title, its likes owner or the source default, at most 200 characters", () => {
    const base: Listing = { source: "deezer", label: "  ", rows: [] };
    expect(labelOf(base, labels)).toBe("default:deezer");
    expect(labelOf({ ...base, likesOf: "nightowl" }, labels)).toBe("nightowl: Likes");
    expect(labelOf({ ...base, label: "й".repeat(250) }, labels)).toHaveLength(200);
  });

  it("reports progress at most every 120 ms", () => {
    let now = 0;
    const seen: number[] = [];
    const report = throttle(
      (n) => seen.push(n),
      120,
      () => now,
    );
    for (const [at, count] of [
      [0, 1],
      [50, 2],
      [119, 3],
      [120, 4],
      [300, 5],
    ]) {
      now = at;
      report(count);
    }
    expect(seen).toEqual([1, 4, 5]);
  });
});

describe("importFile", () => {
  it("posts the picked file and hands over every import it made", async () => {
    const { daemon, started } = setup();
    daemon.startAnswer = [summary("a"), summary("b", { status: "done" })];
    await importFile({ name: "Playlist1.json", data: "e30=" }, undefined, { daemon, started });
    expect(daemon.started).toEqual([{ file: { name: "Playlist1.json", data: "e30=" } }]);
    expect(started).toHaveBeenCalledWith([summary("a"), summary("b", { status: "done" })]);
  });

  it("explains a file the daemon cannot read", async () => {
    const { daemon, started } = setup();
    daemon.startAnswer = new CoreError(400, "INVALID_INPUT");
    await expect(importFile({ name: "x.txt", data: "" }, undefined, { daemon, started })).rejects.toEqual(new ImportError("bad_file"));
  });
});

describe("malformed YouTube answers", () => {
  it("fails as network when the client answers without tracks", async () => {
    const { ports } = setup({}, {
      title: "T",
    } as unknown as YoutubeImportedList);
    await expect(listLink("https://music.youtube.com/playlist?list=PL1", ports, signal())).rejects.toEqual(new ImportError("network"));
  });

  it("skips items that are not tracks", async () => {
    const { ports } = setup({}, {
      title: "T",
      tracks: [
        null,
        { ytId: 5 },
        {
          ytId: "aaaaaaaaaaa",
          title: "A",
          artistTexts: [],
          artistChannelIds: [],
          coverUrl: "",
        },
      ],
    } as unknown as YoutubeImportedList);
    const listing = await listLink("https://music.youtube.com/playlist?list=PL1", ports, signal());
    expect(listing.rows.map((r) => r.title)).toEqual(["A"]);
  });
});
