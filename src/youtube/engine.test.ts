import { describe, expect, it, vi } from "vitest";
import { engineCatalog, engineYoutube, toEngineTrack } from "./engine";
import type { Youtube } from "./index";
import type { YtTrack } from "./types";

const ytTrack: YtTrack = {
  id: "vidAAAAAAA1",
  title: "Song",
  artists: [
    { id: "UCa", name: "A" },
    { id: "unknown", name: "B" },
  ],
  album: { id: "MPREb_1", title: "LP" },
  durationMs: 1000,
  cover: { url: "https://x/c.jpg", width: 512, height: 512 },
  explicit: true,
};

describe("engine ports", () => {
  it("YouTube tracks become engine tracks", () => {
    expect(toEngineTrack(ytTrack)).toEqual({
      id: "vidAAAAAAA1",
      title: "Song",
      artists: "A, B",
      artistId: "UCa",
      artistList: [
        { id: "UCa", name: "A" },
        { id: "unknown", name: "B" },
      ],
      album: { id: "MPREb_1", title: "LP" },
      coverUrl: "https://x/c.jpg",
      durationMs: 1000,
      explicit: true,
    });
  });

  it("quality passes through, unknown codecs are dropped", async () => {
    const resolve = vi.fn(async () => ({
      url: "u",
      mimeType: "audio/webm",
      codec: "opus",
      bitrate: 1,
      servedBy: "WEB_REMIX",
    }));
    const port = engineYoutube({
      playback: {
        resolve,
        fetchWhole: vi.fn(),
        warmUp: vi.fn(),
        reset: vi.fn(),
      },
    } as unknown as Pick<Youtube, "playback">);
    const signal = new AbortController().signal;
    await port.resolve(toEngineTrack(ytTrack), { progressive: true, quality: "hifi", codec: "flac" }, signal);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ id: "vidAAAAAAA1" }), { progressive: true, quality: "hifi", codec: undefined }, signal);
  });

  it("catalog filters map to YouTube filters and only tracks come back", async () => {
    const searchFiltered = vi.fn(async () => [
      { kind: "track" as const, ...ytTrack },
      { kind: "artist" as const, id: "UCa", name: "A" },
    ]);
    const port = engineCatalog({
      catalog: { searchFiltered, radio: vi.fn(async () => [ytTrack]) },
    } as unknown as Pick<Youtube, "catalog">);
    const signal = new AbortController().signal;
    expect((await port.searchFiltered("q", "songs", signal)).map((track) => track.id)).toEqual(["vidAAAAAAA1"]);
    await port.searchFiltered("q", "any", signal);
    await port.searchFiltered("q", "videos", signal);
    expect(searchFiltered.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["track", undefined, "video"]);
    expect(await port.radio("vidAAAAAAA1", { limit: 5 }, signal)).toHaveLength(1);
  });
});
