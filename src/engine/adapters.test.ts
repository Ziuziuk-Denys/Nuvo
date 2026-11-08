import { describe, expect, it } from "vitest";
import { createContinuation, createMatchAdapter, type CatalogPort } from "./adapters";
import { FakeDaemon, track } from "./test/harness";

const catalog = (search: Record<string, ReturnType<typeof track>[]>, radio: ReturnType<typeof track>[] = []): CatalogPort & { queries: string[] } => {
  const queries: string[] = [];
  return {
    queries,
    searchFiltered: async (query) => {
      queries.push(query);
      return search[query] ?? [];
    },
    radio: async () => radio,
  };
};

describe("adapters", () => {
  it("the YouTube cascade runs the searches the daemon asks for and returns only approved tracks", async () => {
    const daemon = new FakeDaemon();
    let round = 0;
    daemon.on("POST /v1/match/next", async (request) => {
      const body = await request.json();
      round += 1;
      if (round === 1) return Response.json({ status: "search", query: "Song Artist", filter: "songs" });
      expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(["yt1"]);
      expect(body.steps).toEqual([{ query: "Song Artist", filter: "songs", failed: false, found: 1 }]);
      return Response.json({ status: "approved", track: { id: "yt1", title: "Song", artists: [{ id: "a", name: "Artist" }], durationMs: 1000 }, score: 90 });
    });
    const adapter = createMatchAdapter("nuvo-core://local", catalog({ "Song Artist": [track("yt1")] }), daemon.fetch);
    const result = await adapter.approvedOn("youtube", track("x", { title: "Song", artists: "Artist" }), new AbortController().signal);
    expect(result).toMatchObject({ score: 90, track: { id: "yt1", artists: "Artist" } });
  });

  it("a track found again by a later step counts once, so the step counts add up to the candidates", async () => {
    const daemon = new FakeDaemon();
    const queries = ["Song Artist", "Song", "Artist Song"];
    let round = 0;
    let last: { candidates: Array<{ id: string }>; steps: Array<{ found: number }> } | null = null;
    daemon.on("POST /v1/match/next", async (request) => {
      const body = await request.json();
      // The daemon's own check (cascade `next`): a mismatch is a 400.
      const counted = body.steps.reduce((sum: number, step: { found: number }) => sum + step.found, 0);
      if (counted !== body.candidates.length) return Response.json({ message: "step counts do not add up to the candidates" }, { status: 400 });
      last = body;
      round += 1;
      if (round <= queries.length) return Response.json({ status: "search", query: queries[round - 1], filter: "songs" });
      return Response.json({ status: "approved", track: { id: "yt3", title: "Song", artists: [{ id: "a", name: "Artist" }], durationMs: 1000 }, score: 90 });
    });
    const search = { "Song Artist": [track("yt1"), track("yt2")], Song: [track("yt2"), track("yt3")], "Artist Song": [track("yt1")] };
    const adapter = createMatchAdapter("nuvo-core://local", catalog(search), daemon.fetch);
    const result = await adapter.approvedOn("youtube", track("x", { title: "Song", artists: "Artist" }), new AbortController().signal);
    expect(result).toMatchObject({ track: { id: "yt3" } });
    expect(last!.candidates.map((c) => c.id)).toEqual(["yt1", "yt2", "yt3"]);
    expect(last!.steps.map((step) => step.found)).toEqual([2, 1, 0]);
  });

  it("pending outcomes and SoundCloud refusals give nothing", async () => {
    const daemon = new FakeDaemon();
    daemon.on("POST /v1/match/next", () => Response.json({ status: "pending", reason: "low_confidence_match" }));
    daemon.on("POST /v1/match/approved", () => Response.json({ status: "pending", reason: "ambiguous_match" }));
    const adapter = createMatchAdapter("nuvo-core://local", catalog({}), daemon.fetch);
    const signal = new AbortController().signal;
    expect(await adapter.approvedOn("youtube", track("x"), signal)).toBeNull();
    expect(await adapter.approvedOn("soundcloud", track("x"), signal, new Set(["sc:1"]))).toBeNull();
    expect(JSON.parse(daemon.callsTo("POST", "/v1/match/approved")[0].body!).exclude).toEqual(["sc:1"]);
  });

  it("continuation ranks through the daemon and falls back to the raw list", async () => {
    const daemon = new FakeDaemon();
    daemon.on("POST /v1/recs/rank", () => Response.json({ items: [{ track: track("r2") }], batchId: "b" }));
    const radio = [track("seed"), track("r1"), track("r2")];
    const ranked = createContinuation("nuvo-core://local", catalog({}, radio), daemon.fetch);
    const request = { context: "radio:seed", seeds: ["seed"], recent: ["seed"], sessionId: null, limit: 10 };
    expect((await ranked.next(request)).map((t) => t.id)).toEqual(["r2"]);
    const down = new FakeDaemon();
    down.on("POST /v1/recs/rank", () => new Response(null, { status: 503 }));
    const raw = createContinuation("nuvo-core://local", catalog({}, radio), down.fetch);
    expect((await raw.next(request)).map((t) => t.id)).toEqual(["r1", "r2"]);
  });

  it("when ranking fails the raw list still drops hidden tracks and keeps at most two per artist", async () => {
    const daemon = new FakeDaemon();
    daemon.on("POST /v1/recs/rank", () => new Response(null, { status: 503 }));
    const hidden = track("h1", { artists: "Hidden Band" });
    daemon.on("GET /v1/recs/suppressions", () =>
      Response.json({
        items: [
          { id: 1, scope: "exact", origin: "user", track: { id: "r2", title: "T", artists: [{ id: "a", name: "Other" }], durationMs: 1000 } },
          { id: 2, scope: "artist", origin: "user", track: { id: "hx", title: "T", artists: [{ id: "h", name: "Hidden Band" }], durationMs: 1000 } },
        ],
      }),
    );
    const radio = [
      track("r1", { artists: "A" }),
      track("r2", { artists: "B" }),
      hidden,
      track("r3", { artists: "A" }),
      track("r4", { artists: "A" }),
      track("r5", { artists: "C" }),
    ];
    const got = await createContinuation("nuvo-core://local", catalog({}, radio), daemon.fetch).next({
      context: "radio:seed",
      seeds: ["seed"],
      recent: [],
      sessionId: null,
      limit: 10,
    });
    expect(got.map((t) => t.id)).toEqual(["r1", "r3", "r5"]);
  });

  it("the local list and the catalog radio are asked at the same time", async () => {
    const daemon = new FakeDaemon();
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    daemon.on("GET /v1/local/related", async () => {
      started.push("local");
      await gate;
      return Response.json({ items: [] });
    });
    daemon.on("POST /v1/recs/rank", () => new Response(null, { status: 503 }));
    const port: CatalogPort = {
      searchFiltered: async () => [],
      radio: async () => {
        started.push("catalog");
        release();
        return [];
      },
    };
    await createContinuation("nuvo-core://local", port, daemon.fetch).next({ context: "radio:seed", seeds: ["seed"], recent: [], sessionId: null, limit: 10 });
    expect(started).toEqual(["local", "catalog"]);
  });

  it("continuation sends daemon snapshots and keeps each pick's reason", async () => {
    const daemon = new FakeDaemon();
    let body: { candidates: Array<{ id: string; artists: unknown }>; sessionId?: string } | null = null;
    daemon.on("POST /v1/recs/rank", async (request) => {
      body = await request.json();
      return Response.json({
        batchId: "b",
        items: [
          { track: { id: "r2", title: "as stored", artists: [{ id: "x", name: "X" }] }, reason: { kind: "artist", name: "Artist r2" } },
          { track: { id: "old", title: "Old", artists: [{ id: "o", name: "Oldie" }], durationMs: 1000 }, reason: { kind: "similar" } },
          { track: { title: "no id" }, reason: { kind: "similar" } },
        ],
      });
    });
    const radio = [track("r1", { artists: "A, B" }), track("r2")];
    const continuation = createContinuation("nuvo-core://local", catalog({}, radio), daemon.fetch);
    const got = await continuation.next({ context: "radio:seed", seeds: ["seed"], recent: [], sessionId: "s1", limit: 10 });
    expect(body!.sessionId).toBe("s1");
    expect(body!.candidates[0].artists).toEqual([
      { id: "unknown", name: "A" },
      { id: "unknown", name: "B" },
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({ ...radio[1], reason: { kind: "artist", name: "Artist r2" } });
    expect(got[1]).toMatchObject({ id: "old", artists: "Oldie", reason: { kind: "similar" } });
  });

  it("a SoundCloud seed takes its related tracks from the daemon, never the YouTube radio", async () => {
    const daemon = new FakeDaemon();
    daemon.on("GET /v1/sc/tracks/sc:5/related", () =>
      Response.json({ items: [{ id: "sc:6", title: "Six", artists: [{ id: "sc_user_1", name: "One" }], durationMs: 1000 }] }),
    );
    let ranked: { candidates: Array<{ id: string }> } | null = null;
    daemon.on("POST /v1/recs/rank", async (request) => {
      ranked = await request.json();
      return Response.json({ batchId: "b", items: [{ track: { id: "sc:6", title: "Six", artists: [{ id: "sc_user_1", name: "One" }] } }] });
    });
    const radio: string[] = [];
    const port: CatalogPort = {
      searchFiltered: async () => [],
      radio: async (id) => {
        radio.push(id);
        return [];
      },
    };
    const got = await createContinuation("nuvo-core://local", port, daemon.fetch).next({
      context: "continue:list",
      seeds: ["y1", "sc:5"],
      recent: [],
      sessionId: null,
      limit: 10,
    });
    expect(radio).toEqual([]);
    expect(ranked!.candidates.map((c) => c.id)).toEqual(["sc:6"]);
    expect(got.map((t) => t.id)).toEqual(["sc:6"]);
  });

  it("a catalog that fails still asks the daemon, whose stored lists keep the music going", async () => {
    const daemon = new FakeDaemon();
    let candidates: unknown[] | null = null;
    daemon.on("POST /v1/recs/rank", async (request) => {
      candidates = (await request.json()).candidates;
      return Response.json({ batchId: "b", items: [{ track: { id: "pooled", title: "P", artists: [{ id: "a", name: "A" }] } }] });
    });
    const port: CatalogPort = {
      searchFiltered: async () => [],
      radio: async () => {
        throw new Error("offline");
      },
    };
    const got = await createContinuation("nuvo-core://local", port, daemon.fetch).next({
      context: "radio:y1",
      seeds: ["y1"],
      recent: [],
      sessionId: null,
      limit: 10,
    });
    expect(candidates).toEqual([]);
    expect(got.map((t) => t.id)).toEqual(["pooled"]);
  });
});
