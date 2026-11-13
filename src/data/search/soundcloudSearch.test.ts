import { afterEach, describe, expect, it, vi } from "vitest";
import { searchSoundCloud } from "./soundcloudSearch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchSoundCloud", () => {
  it("asks the core and keeps the preview mark on each track", async () => {
    const items = [
      {
        id: "sc:1",
        title: "Get Lucky",
        artists: [{ id: "sc_user_9", name: "DJ KB" }],
        durationMs: 246_381,
        cover: { url: "https://i1.sndcdn.com/a.jpg", width: 500, height: 500 },
      },
      { id: "sc:2", title: "Get Lucky", artists: [{ id: "sc_user_8", name: "Daft Punk" }], durationMs: 30_000, preview: true },
    ];
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const hits = await searchSoundCloud("get lucky", new AbortController().signal);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("nuvo-core://local/v1/sc/search?q=get+lucky");
    expect(hits.map((hit) => [hit.track.id, hit.track.artists, hit.track.coverUrl, hit.preview])).toEqual([
      ["sc:1", "DJ KB", "https://i1.sndcdn.com/a.jpg", false],
      ["sc:2", "Daft Punk", "", true],
    ]);
    expect(hits[0].track.artistId).toBeUndefined();
  });
});
