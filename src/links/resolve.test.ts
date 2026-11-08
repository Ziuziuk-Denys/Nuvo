// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CoreError, type Heard, type InspectAnswer } from "./core";
import { listenAgain, resolveLink, type LinkPorts, type Stage } from "./resolve";
import { routeLink, type LinkRoute } from "./router";
import { encodeShare } from "./shareCodec";
import type { CatalogTrack, MatchSource } from "./types";

const TIKTOK = "https://www.tiktok.com/@someone/video/7000000000000000011";
const CANONICAL = "https://www.tiktok.com/@i/video/7000000000000000011";

function track(id: string, title: string, artist = "Artist"): CatalogTrack {
  return {
    id,
    title,
    artists: [{ id: "", name: artist }],
    durationMs: 200_000,
  };
}

type Outcome = "approved" | "pending" | "none";

/**
 * A fake daemon and YouTube client. The cascade asks for one search of the title, then decides by the
 * `outcomes` table (default "none"); every search returns one track named after the query.
 */
function fakePorts(
  options: {
    inspect?: InspectAnswer;
    heard?: Heard;
    outcomes?: Record<string, Outcome>;
    youtube?: CatalogTrack | null;
    fetched?: Record<string, unknown>;
  } = {},
) {
  const sources: MatchSource[] = [];
  const calls: string[] = [];
  const ports: LinkPorts = {
    inspect: vi.fn(async () => {
      calls.push("inspect");
      return options.inspect ?? { error: "unavailable" };
    }),
    recognize: vi.fn(async (_url, _part, _signal, onListening) => {
      calls.push("recognize");
      onListening("clean");
      return options.heard ?? ({ kind: "not_found", more: true } as Heard);
    }),
    matchNext: vi.fn(async ({ source, candidates, steps }) => {
      if (steps.length === 0) {
        sources.push(source);
        calls.push(`match:${source.title}`);
        return {
          status: "search" as const,
          query: source.title,
          filter: "songs" as const,
        };
      }
      const outcome = options.outcomes?.[source.title] ?? "none";
      if (outcome === "approved") return { status: "approved" as const, track: candidates[0], score: 97 };
      if (outcome === "pending")
        return {
          status: "pending" as const,
          reason: "ambiguous_match" as const,
          score: 80,
          proposedTrack: candidates[0],
        };
      return {
        status: "pending" as const,
        reason: "no_catalog_candidates" as const,
      };
    }),
    search: vi.fn(async (query: string) => [track(`yt-${query}`, query), track(`alt-${query}`, `${query} (Live)`)]),
    youtubeTrack: vi.fn(async () => (options.youtube === undefined ? track("dQw4w9WgXcQ", "Never Gonna Give You Up", "Rick Astley") : options.youtube)),
    soundcloudLookup: vi.fn(async () => null),
    soundcloudTrack: vi.fn(async () => null),
    fetchJson: vi.fn(async (url: string) => ({
      status: options.fetched?.[url] ? 200 : 404,
      body: options.fetched?.[url] ?? null,
    })),
  };
  return { ports, sources, calls };
}

async function run(route: LinkRoute | string, ports: LinkPorts, stages: Stage[] = []) {
  const routed = typeof route === "string" ? (routeLink(route) as LinkRoute) : route;
  return resolveLink(routed, ports, (stage) => stages.push(stage), new AbortController().signal);
}

const licensed: InspectAnswer = {
  kind: "tiktok",
  canonicalUrl: CANONICAL,
  sound: {
    title: "I Will Survive",
    author: "Gloria Gaynor",
    original: false,
    album: "Love Tracks",
    clipMs: 60_000,
  },
};
const original: InspectAnswer = {
  kind: "tiktok",
  canonicalUrl: CANONICAL,
  sound: {
    title: "original sound",
    author: "tiff",
    original: true,
    clipMs: 10_000,
  },
};

describe("the TikTok flow", () => {
  it("a licensed sound found by name needs no recognition", async () => {
    const { ports, calls, sources } = fakePorts({
      inspect: licensed,
      outcomes: { "I Will Survive": "approved" },
    });
    const stages: Stage[] = [];
    const result = await run(TIKTOK, ports, stages);
    expect(result).toMatchObject({
      kind: "track",
      via: "tiktok_name",
      sure: true,
      listenUrl: CANONICAL,
      track: { id: "yt-I Will Survive" },
    });
    expect(calls).toEqual(["inspect", "match:I Will Survive"]);
    expect(sources[0]).toEqual({
      title: "I Will Survive",
      artists: ["Gloria Gaynor"],
    });
    expect(stages).toEqual([{ stage: "reading_tiktok" }, { stage: "looking", title: "I Will Survive" }]);
  });

  it("a pending name match goes on to listening, and the recognized song wins", async () => {
    const { ports, calls } = fakePorts({
      inspect: licensed,
      outcomes: { "I Will Survive": "pending", Survivor: "approved" },
      heard: {
        kind: "found",
        title: "Survivor",
        artist: "Destiny's Child",
        via: "clean",
      },
    });
    const result = await run(TIKTOK, ports);
    expect(result).toMatchObject({
      kind: "track",
      via: "recognized_sound",
      sure: true,
      track: { id: "yt-Survivor" },
    });
    expect(calls).toEqual(["inspect", "match:I Will Survive", "recognize", "match:Survivor"]);
    expect(ports.recognize).toHaveBeenCalledWith(CANONICAL, 0, expect.anything(), expect.any(Function));
  });

  it("an original sound goes straight to listening", async () => {
    const { ports, calls } = fakePorts({
      inspect: original,
      outcomes: { Teardrop: "approved" },
      heard: {
        kind: "found",
        title: "Teardrop",
        artist: "Massive Attack",
        via: "mix",
      },
    });
    const result = await run(TIKTOK, ports);
    expect(calls).toEqual(["inspect", "recognize", "match:Teardrop"]);
    expect(result).toMatchObject({ kind: "track", via: "recognized_video" });
  });

  it("an 'original sound' title in another language counts as original", async () => {
    const { ports, calls } = fakePorts({
      inspect: {
        ...original,
        sound: {
          title: "som original - tiff",
          author: "tiff",
          original: false,
        },
      },
    });
    await run(TIKTOK, ports);
    expect(calls).toEqual(["inspect", "recognize"]);
  });

  it("nothing found names the sound and keeps the proposal, or says it was an original sound", async () => {
    const named = fakePorts({
      inspect: licensed,
      outcomes: { "I Will Survive": "pending" },
    });
    expect(await run(TIKTOK, named.ports)).toMatchObject({
      kind: "not_found",
      reason: "named_sound",
      title: "I Will Survive",
      author: "Gloria Gaynor",
      proposal: { id: "yt-I Will Survive" },
      more: true,
    });
    const plain = fakePorts({
      inspect: original,
      heard: { kind: "not_found", more: false },
    });
    expect(await run(TIKTOK, plain.ports)).toEqual({
      kind: "not_found",
      reason: "original_sound",
      more: false,
      listenUrl: CANONICAL,
    });
  });

  it("never sends the clip length as the song's duration", async () => {
    const { ports, sources } = fakePorts({
      inspect: licensed,
      outcomes: { "I Will Survive": "pending", Survivor: "approved" },
      heard: {
        kind: "found",
        title: "Survivor",
        artist: "Destiny's Child",
        via: "clean",
      },
    });
    await run(TIKTOK, ports);
    expect(sources.every((source) => source.durationMs === undefined)).toBe(true);
  });

  it("a listening error after a named sound still offers the name; without one it is the error", async () => {
    const named = fakePorts({
      inspect: licensed,
      heard: { kind: "error", code: "tool_missing" },
    });
    expect(await run(TIKTOK, named.ports)).toMatchObject({
      kind: "not_found",
      reason: "named_sound",
    });
    const plain = fakePorts({
      inspect: original,
      heard: { kind: "error", code: "tool_missing" },
    });
    expect(await run(TIKTOK, plain.ports)).toEqual({
      kind: "error",
      code: "tool_missing",
      service: "tiktok",
    });
    const gone = fakePorts({ inspect: { error: "unavailable" } });
    expect(await run(TIKTOK, gone.ports)).toEqual({
      kind: "error",
      code: "unavailable",
      service: "tiktok",
    });
  });

  it("'Try another part' listens again with part 1", async () => {
    const { ports } = fakePorts({ heard: { kind: "not_found", more: true } });
    const result = await listenAgain(CANONICAL, 1, ports, () => undefined, new AbortController().signal);
    expect(ports.recognize).toHaveBeenCalledWith(CANONICAL, 1, expect.anything(), expect.any(Function));
    expect(result).toMatchObject({ kind: "not_found", more: false });
  });
});

describe("other links", () => {
  it("a YouTube video plays by id, offers its playlist and listening to the video", async () => {
    const { ports, calls } = fakePorts();
    const result = await run("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefgh", ports);
    expect(result).toMatchObject({
      kind: "track",
      via: "link",
      sure: true,
      playlistUrl: "https://www.youtube.com/playlist?list=PLabcdefgh",
      listenUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefgh",
    });
    expect(calls).toEqual([]);
    expect(await run("https://youtu.be/dQw4w9WgXcQ", fakePorts({ youtube: null }).ports)).toEqual({ kind: "error", code: "unavailable", service: "youtube" });
  });

  it("a Deezer song is matched by name and keeps its ISRC", async () => {
    const { ports, sources } = fakePorts({
      outcomes: { "Harder, Better, Faster, Stronger": "approved" },
      fetched: {
        "https://api.deezer.com/track/3135556": {
          title: "Harder, Better, Faster, Stronger",
          duration: 226,
          isrc: "GBDUW0000059",
          artist: { name: "Daft Punk" },
        },
      },
    });
    const result = await run("https://www.deezer.com/en/track/3135556", ports);
    expect(sources[0]).toEqual({
      title: "Harder, Better, Faster, Stronger",
      artists: ["Daft Punk"],
      durationMs: 226_000,
    });
    expect(result).toMatchObject({
      kind: "track",
      via: "by_name",
      track: { isrc: "GBDUW0000059" },
    });
  });

  it("a short link is read once through the daemon and routed again", async () => {
    const { ports } = fakePorts({
      inspect: {
        kind: "redirect",
        canonicalUrl: "https://www.deezer.com/en/playlist/908622995",
      },
    });
    expect(await run("https://deezer.page.link/abc", ports)).toEqual({
      kind: "import",
      service: "deezer",
      url: "https://www.deezer.com/en/playlist/908622995",
    });
    const loop = fakePorts({
      inspect: {
        kind: "redirect",
        canonicalUrl: "https://deezer.page.link/again",
      },
    });
    expect(await run("https://deezer.page.link/abc", loop.ports)).toEqual({
      kind: "error",
      code: "unsupported",
      service: "deezer",
    });
  });

  it("a Spotify short link lands on the playlist import", async () => {
    const { ports } = fakePorts({
      inspect: { kind: "redirect", canonicalUrl: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1" },
    });
    expect(await run("https://spotify.link/AbCdEf", ports)).toEqual({
      kind: "import",
      service: "spotify",
      url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    });
  });

  it("another video uses yt-dlp's track and artist before listening", async () => {
    const tagged = fakePorts({
      inspect: {
        kind: "media",
        canonicalUrl: "https://www.instagram.com/reel/x/",
        media: {
          track: "Teardrop",
          artist: "Massive Attack",
          durationMs: 330_000,
          isLive: false,
        },
      },
      outcomes: { Teardrop: "approved" },
    });
    expect(await run("https://www.instagram.com/reel/x/", tagged.ports)).toMatchObject({ kind: "track", via: "media_tags" });
    expect(tagged.calls).toEqual(["inspect", "match:Teardrop"]);
    const untagged = fakePorts({
      inspect: {
        kind: "media",
        canonicalUrl: "https://www.instagram.com/reel/x/",
        media: { title: "my day", isLive: false },
      },
    });
    expect(await run("https://www.instagram.com/reel/x/", untagged.ports)).toMatchObject({ kind: "not_found", reason: "song", more: true });
    expect(untagged.calls).toEqual(["inspect", "recognize"]);
  });

  it("an unreachable daemon is core_down", async () => {
    const { ports } = fakePorts();
    ports.inspect = vi.fn(async () => Promise.reject(new CoreError(0, "core_down")));
    expect(await run("https://www.instagram.com/reel/x/", ports)).toEqual({
      kind: "error",
      code: "core_down",
      service: "nuvo",
    });
  });

  it("a locked library says so", async () => {
    const { ports } = fakePorts();
    ports.inspect = vi.fn(async () => Promise.reject(new CoreError(423, "LOCKED")));
    expect(await run("https://www.instagram.com/reel/x/", ports)).toEqual({
      kind: "error",
      code: "locked",
      service: "nuvo",
    });
  });

  it("a failure outside the daemon answers a neutral failed instead of throwing", async () => {
    const { ports } = fakePorts();
    ports.youtubeTrack = vi.fn(async () => {
      throw new TypeError("catalog is not ready");
    });
    expect(await run("https://youtu.be/dQw4w9WgXcQ", ports)).toEqual({
      kind: "error",
      code: "failed",
      service: "nuvo",
    });
    // a cascade that never decides ends in matchByName's own error, which is no daemon error either
    const endless = fakePorts({
      fetched: { "https://api.deezer.com/track/3135556": { title: "Harder", duration: 224, artist: { name: "Daft Punk" } } },
    }).ports;
    endless.matchNext = vi.fn(async () => ({ status: "search" as const, query: "again", filter: "songs" as const }));
    expect(await run("https://www.deezer.com/en/track/3135556", endless)).toMatchObject({ kind: "error", code: "failed" });
    // a daemon error the client has no word for is Nuvo's own failure too, not a gone post
    const broken = fakePorts().ports;
    broken.youtubeTrack = vi.fn(() => Promise.reject(new CoreError(500, "INTERNAL")));
    expect(await run("https://youtu.be/dQw4w9WgXcQ", broken)).toMatchObject({ kind: "error", code: "failed" });
  });

  it("an abort rejects instead of answering", async () => {
    const { ports } = fakePorts({ inspect: licensed });
    const controller = new AbortController();
    ports.matchNext = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(resolveLink(routeLink(TIKTOK) as LinkRoute, ports, () => undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("shared links", () => {
  it("a playlist opens the preview, nothing is played or matched", async () => {
    const payload = await encodeShare({
      title: "Mix",
      tracks: [
        { source: "text", artist: "A", title: "One" },
        { source: "youtube", id: "dQw4w9WgXcQ" },
      ],
    });
    const { ports, calls } = fakePorts();
    expect(await run(`nuvo://share?id=${payload}`, ports)).toMatchObject({
      kind: "share",
      share: { title: "Mix" },
    });
    expect(calls).toEqual([]);
    expect(ports.youtubeTrack).not.toHaveBeenCalled();
  });

  it("a shared song whose video is gone is matched by name and says so", async () => {
    const payload = await encodeShare({
      title: "",
      tracks: [
        {
          source: "youtube",
          id: "dQw4w9WgXcQ",
          artist: "Rick Astley",
          title: "Never Gonna Give You Up",
          durationSec: 213,
        },
      ],
    });
    const { ports, sources } = fakePorts({
      youtube: null,
      outcomes: { "Never Gonna Give You Up": "approved" },
    });
    expect(await run(`nuvo://share?id=${payload}`, ports)).toMatchObject({
      kind: "track",
      via: "share_gone",
      sure: true,
    });
    expect(sources[0]).toEqual({
      title: "Never Gonna Give You Up",
      artists: ["Rick Astley"],
      durationMs: 213_000,
    });
  });

  it("damaged and future links say which", async () => {
    const { ports } = fakePorts();
    expect(await run({ kind: "share", payload: "EAAB" }, ports)).toEqual({
      kind: "error",
      code: "bad_share",
      service: "nuvo",
    });
    expect(await run({ kind: "share", payload: "IAABBANBCUI" }, ports)).toEqual({ kind: "error", code: "newer_link", service: "nuvo" });
  });
});
