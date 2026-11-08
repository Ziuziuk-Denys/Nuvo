import { describe, expect, it, vi } from "vitest";
import { CoreError, createImportsDaemon } from "./core";
import type { FetchLike } from "./http";

const BASE = "nuvo-core://local";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createImportsDaemon", () => {
  it("posts listed rows and returns the summaries", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ items: [{ id: "i1", status: "running" }] }));
    const daemon = createImportsDaemon(BASE, fetch);
    const items = await daemon.start({
      source: "deezer",
      label: "Northbound",
      rows: [{ title: "Paper Moons", artists: ["Mira Holt"] }],
    });
    expect(items).toEqual([{ id: "i1", status: "running" }]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("nuvo-core://local/v1/imports");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      source: "deezer",
      label: "Northbound",
      rows: [{ title: "Paper Moons", artists: ["Mira Holt"] }],
    });
  });

  it("builds the report query with the label chip, page size and cursor", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ items: [] }));
    await createImportsDaemon(BASE, fetch).rows("a/b", "review", "41");
    expect(fetch.mock.calls[0][0]).toBe("nuvo-core://local/v1/imports/a%2Fb/rows?label=review&limit=100&cursor=41");
  });

  it("turns error answers into CoreError with the daemon's code", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ message: "locked", code: "LOCKED", reqId: "r" }, 423));
    const error = await createImportsDaemon(BASE, fetch)
      .list()
      .catch((e) => e);
    expect(error).toBeInstanceOf(CoreError);
    expect([error.status, error.code]).toEqual([423, "LOCKED"]);
  });

  it("reports an unreachable daemon as status 0", async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await createImportsDaemon(BASE, fetch)
      .next("i1")
      .catch((e) => e);
    expect([error.status, error.code]).toEqual([0, "CORE_DOWN"]);
  });

  it("sends a pick with its track and a keep without one", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ id: 3 }));
    const daemon = createImportsDaemon(BASE, fetch);
    await daemon.decide("i1", 3, "keep");
    await daemon.decide("i1", 3, "pick", {
      id: "abcdefghijk",
      title: "Paper Moons",
      artists: [],
      durationMs: 1,
    });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      decision: "keep",
    });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).track.id).toBe("abcdefghijk");
    expect(fetch.mock.calls[0][1]?.method).toBe("PATCH");
  });

  it("adds a track through the bulk route, which skips a song already in the playlist", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ added: 0, items: [], rejected: 0 }));
    const song = {
      id: "sc:42",
      title: "Paper Moons",
      artists: [],
      durationMs: 1,
    };
    await createImportsDaemon(BASE, fetch).addToPlaylist("p1", song);
    expect(fetch.mock.calls[0][0]).toBe("nuvo-core://local/v1/me/playlists/p1/tracks");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      tracks: [song],
    });
  });

  it("fails when the daemon rejects the snapshot", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ added: 0, items: [], rejected: 1 }));
    await expect(
      createImportsDaemon(BASE, fetch).addToPlaylist("p1", {
        id: "x",
        title: "",
        artists: [],
        durationMs: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("keeps, reads and clears the waiting song", async () => {
    const job = {
      playlistId: "p1",
      track: { id: "t", title: "T", artists: [], durationMs: 1 },
    };
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ job }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const daemon = createImportsDaemon(BASE, fetch);
    await daemon.savePendingTrack(job);
    expect(await daemon.pendingTrack()).toEqual(job);
    await daemon.clearPendingTrack();
    expect(fetch.mock.calls.map(([url, init]) => [init?.method, url])).toEqual([
      ["PUT", "nuvo-core://local/v1/imports/pending-track"],
      ["GET", "nuvo-core://local/v1/imports/pending-track"],
      ["DELETE", "nuvo-core://local/v1/imports/pending-track"],
    ]);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(job);
  });

  it("reads the SoundCloud listing as a soundcloud listing", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ label: "nightowl", likesOf: "nightowl", rows: [] }));
    const listing = await createImportsDaemon(BASE, fetch).soundcloudListing("https://soundcloud.com/nightowl/likes");
    expect(fetch.mock.calls[0][0]).toBe("nuvo-core://local/v1/sc/import?url=https%3A%2F%2Fsoundcloud.com%2Fnightowl%2Flikes");
    expect(listing).toEqual({
      source: "soundcloud",
      label: "nightowl",
      likesOf: "nightowl",
      rows: [],
    });
  });

  it("marks a SoundCloud likes listing that stopped part way, and appends pages", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ label: "nightowl", likesOf: "nightowl", partial: true, rows: [{ title: "a", artists: [] }] }));
    const listing = await createImportsDaemon(BASE, fetch).soundcloudListing("https://soundcloud.com/nightowl/likes");
    expect(listing.notice).toEqual({ kind: "cut", kept: 1 });

    const append = vi.fn<FetchLike>(async () => json({ id: "i1" }));
    await createImportsDaemon(BASE, append).appendRows("i1", [{ title: "b", artists: [] }]);
    expect(append.mock.calls[0][0]).toBe("nuvo-core://local/v1/imports/i1/rows");
    expect(JSON.parse(String(append.mock.calls[0][1]?.body))).toEqual({ rows: [{ title: "b", artists: [] }] });
  });

  it("reads a Spotify listing, partial with or without the total", async () => {
    const row = { title: "a", artists: ["b"] };
    const fetch = vi.fn<FetchLike>(async () => json({ label: "Rock Classics", rows: [row], partial: true, total: 200 }));
    const daemon = createImportsDaemon(BASE, fetch);
    const listing = await daemon.spotifyListing("https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U");
    expect(fetch.mock.calls[0][0]).toBe("nuvo-core://local/v1/spotify/import?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F37i9dQZF1DWXRqgorJj26U");
    expect(listing).toEqual({ source: "spotify", label: "Rock Classics", rows: [row], notice: { kind: "partial", shown: 1, total: 200 } });
    fetch.mockImplementation(async () => json({ label: "Album", rows: [row] }));
    expect((await daemon.spotifyListing("https://open.spotify.com/album/x")).notice).toBeUndefined();
  });

  it("searches SoundCloud with the query and a cap of 25", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ items: [{ id: "sc:1" }] }));
    const items = await createImportsDaemon(BASE, fetch).soundcloudSearch("Mira Holt Paper Moons");
    expect(fetch.mock.calls[0][0]).toBe("nuvo-core://local/v1/sc/search?q=Mira+Holt+Paper+Moons&limit=25");
    expect(items).toEqual([{ id: "sc:1" }]);
  });
});

describe("createImportsDaemon with malformed answers", () => {
  it("turns an unreadable success body into an UPSTREAM error", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response("<html>", { status: 200 }));
    const error = await createImportsDaemon(BASE, fetch)
      .list()
      .catch((e) => e);
    expect([error.status, error.code]).toEqual([200, "UPSTREAM"]);
  });

  it("ignores a non-string error code", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ code: 5 }, 503));
    const error = await createImportsDaemon(BASE, fetch)
      .list()
      .catch((e) => e);
    expect([error.status, error.code]).toEqual([503, "UPSTREAM"]);
  });
});
