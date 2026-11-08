import { describe, expect, it } from "vitest";
import { createRecsClient, skipsOnDislike, suggestRequest, SUGGEST_SEEDS } from "./recsClient";
import { BASE, FakeDaemon, track } from "./test/harness";
import type { QueueEntry } from "./types";

const entry = (id: string, origin: QueueEntry["origin"]): QueueEntry => ({ entryId: `e-${id}`, track: track(id), origin, order: 0 });

describe("recs client", () => {
  it("sends Not interested with a daemon snapshot and undoes by id", async () => {
    const daemon = new FakeDaemon();
    daemon.on("POST /v1/recs/not-interested", () => Response.json({ suppressionId: 7, offerHideArtist: true }));
    daemon.on("DELETE /v1/recs/suppressions/7", () => new Response(null, { status: 204 }));
    const recs = createRecsClient(BASE, daemon.fetch);
    expect(await recs.notInterested(track("a", { artists: "One" }), "work")).toEqual({ suppressionId: 7, offerHideArtist: true });
    const sent = JSON.parse(daemon.callsTo("POST", "/v1/recs/not-interested")[0].body!);
    expect(sent).toMatchObject({ trackId: "a", scope: "work", track: { id: "a", artists: [{ id: "unknown", name: "One" }] } });
    expect(await recs.undo(7)).toBe(true);
  });

  it("tells a locked daemon from one that is starting or down, and treats a vanished suppression as undone", async () => {
    const daemon = new FakeDaemon();
    daemon.on("POST /v1/recs/not-interested", () => new Response(null, { status: 423 }));
    daemon.on("DELETE /v1/recs/suppressions/1", () => new Response(null, { status: 404 }));
    daemon.on("DELETE /v1/recs/suppressions/2", () => new Response(null, { status: 503 }));
    daemon.on("DELETE /v1/recs/suppressions/3", () => new Response(null, { status: 423 }));
    daemon.on("GET /v1/me/recommendations/daily-mixes", () => new Response("not json", { status: 200 }));
    const recs = createRecsClient(BASE, daemon.fetch);
    expect(await recs.notInterested(track("a"), "exact")).toBe("locked");
    expect(await recs.undo(1)).toBe(true);
    expect(await recs.undo(2)).toBe("unavailable");
    expect(await recs.undo(3)).toBe("locked");
    expect(await recs.homeMixes()).toEqual([]);

    const starting = new FakeDaemon();
    starting.on("POST /v1/recs/not-interested", () => new Response(null, { status: 503 }));
    expect(await createRecsClient(BASE, starting.fetch).notInterested(track("a"), "exact")).toBe("unavailable");
    const offline = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    expect(await createRecsClient(BASE, offline).notInterested(track("a"), "exact")).toBe("unavailable");
  });

  it("reads Home mixes as engine tracks and drops broken ones", async () => {
    const daemon = new FakeDaemon();
    daemon.on("GET /v1/me/recommendations/daily-mixes", () =>
      Response.json({
        items: [
          {
            id: "daily-mix-discover",
            title: "New to you",
            description: "d",
            tracks: [{ id: "n1", title: "N", artists: [{ id: "x", name: "Nova" }], cover: { url: "u" } }, { title: "no id" }],
          },
          { title: "no id" },
        ],
      }),
    );
    const mixes = await createRecsClient(BASE, daemon.fetch).homeMixes();
    expect(mixes).toHaveLength(1);
    expect(mixes[0]).toMatchObject({ id: "daily-mix-discover", title: "New to you" });
    expect(mixes[0].tracks).toEqual([expect.objectContaining({ id: "n1", artists: "Nova", coverUrl: "u" })]);
  });

  it("skips the playing track wherever it came from, and no other", () => {
    expect(skipsOnDislike({ current: entry("a", "continuation") }, "a")).toBe(true);
    expect(skipsOnDislike({ current: entry("a", "list") }, "a")).toBe(true);
    expect(skipsOnDislike({ current: entry("a", "continuation") }, "b")).toBe(false);
    expect(skipsOnDislike({ current: null }, "a")).toBe(false);
  });

  it("lists hidden tracks as engine tracks with fade times, and tells a failure from an empty list", async () => {
    const daemon = new FakeDaemon();
    daemon.on("GET /v1/recs/suppressions", () =>
      Response.json({
        items: [
          {
            id: 3,
            scope: "work",
            origin: "user",
            track: { id: "a", title: "A", artists: [{ id: "x", name: "Xo" }] },
            penalty: 1,
            fadesAt: "2027-03-01T00:00:00.000Z",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
          { id: 4, scope: "artist_forever", origin: "user", track: null, penalty: 1, fadesAt: null, createdAt: "2026-11-01T00:00:00.000Z" },
          { id: "bad", scope: "work" },
          { id: 5, scope: "galaxy" },
          null,
        ],
      }),
    );
    const recs = createRecsClient(BASE, daemon.fetch);
    expect(await recs.suppressions()).toEqual([
      { id: 3, scope: "work", origin: "user", track: expect.objectContaining({ id: "a", artists: "Xo" }), fadesAt: Date.parse("2027-03-01T00:00:00.000Z") },
      { id: 4, scope: "artist_forever", origin: "user", track: null, fadesAt: null },
    ]);
    const locked = new FakeDaemon();
    locked.on("GET /v1/recs/suppressions", () => new Response(null, { status: 423 }));
    expect(await createRecsClient(BASE, locked.fetch).suppressions()).toBe("locked");
  });

  it("asks whether to start from artists and saves the starters as snapshots", async () => {
    const daemon = new FakeDaemon();
    daemon.on("GET /v1/recs/start", () => Response.json({ needed: true }));
    daemon.on("PUT /v1/recs/starters", () => new Response(null, { status: 204 }));
    const recs = createRecsClient(BASE, daemon.fetch);
    expect(await recs.coldStart()).toBe(true);
    expect(await recs.saveStarters([track("s1", { artists: "Sol" })])).toBe(true);
    expect(JSON.parse(daemon.callsTo("PUT", "/v1/recs/starters")[0].body!)).toEqual({
      tracks: [{ id: "s1", title: "Title s1", artists: [{ id: "unknown", name: "Sol" }], durationMs: 200_000 }],
    });
    const down = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    expect(await createRecsClient(BASE, down).coldStart()).toBe(false);
    expect(await createRecsClient(BASE, down).saveStarters([track("s1")])).toBe("unavailable");
  });

  it("a suggestion request stays within the daemon's limits for any playlist length", () => {
    const ids = Array.from({ length: 450 }, (_, i) => `t${i}`);
    const request = suggestRequest("p1", ids);
    expect(request).toMatchObject({ context: "suggest:p1", sessionId: null, limit: 10 });
    expect(request.seeds).toEqual(ids.slice(-SUGGEST_SEEDS));
    expect(request.recent).toHaveLength(200);
    expect(request.recent.at(-1)).toBe("t449");
  });
});
