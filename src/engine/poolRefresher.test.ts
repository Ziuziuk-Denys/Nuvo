import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { POOL_EVERY_MS, POOL_GAP_MS, POOL_IDLE_MS, POOL_KEY, PoolRefresher } from "./poolRefresher";
import { advance, BASE, FakeDaemon, MemoryStorage, track } from "./test/harness";
import type { Track } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

function setup(
  seeds: string[],
  radio: (id: string) => Track[] | Error = (id) => [track(`${id}-1`, { artists: "A, B" }), track(`${id}-2`)],
  scSeeds: string[] = [],
) {
  const daemon = new FakeDaemon();
  daemon.on("GET /v1/recs/seeds", (_request, url) => Response.json({ seeds: url.searchParams.get("source") === "sc_related" ? scSeeds : seeds }));
  daemon.on("PUT /v1/recs/pool", () => new Response(null, { status: 204 }));
  daemon.on("POST /v1/recs/pool/sc-related", () => Response.json({ stored: 3 }));
  const storage = new MemoryStorage();
  const radioCalls: string[] = [];
  let busy = false;
  const listeners = new Set<() => void>();
  const deps = {
    base: BASE,
    catalog: {
      radio: async (id: string) => {
        radioCalls.push(id);
        const answer = radio(id);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    fetch: daemon.fetch,
    storage,
    now: () => Date.now(),
    busy: () => busy,
    onStatus: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    log: vi.fn(),
  };
  const setBusy = (on: boolean) => {
    busy = on;
    listeners.forEach((listener) => listener());
  };
  return { daemon, storage, radioCalls, deps, setBusy, refresher: new PoolRefresher(deps) };
}

describe("pool refresher", () => {
  it("after a minute of idle stores each stale seed's radio 3 s apart, then rests a day", async () => {
    const s = setup(["s1", "s2"]);
    await advance(POOL_IDLE_MS - 100, 1000);
    expect(s.daemon.callsTo("GET", "/v1/recs/seeds?source=yt_radio")).toHaveLength(0);
    await advance(100);
    expect(s.radioCalls).toEqual(["s1"]);
    await advance(POOL_GAP_MS);
    expect(s.radioCalls).toEqual(["s1", "s2"]);
    const puts = s.daemon.callsTo("PUT", "/v1/recs/pool").map((c) => JSON.parse(c.body!));
    expect(puts.map((p) => [p.seedId, p.source])).toEqual([
      ["s1", "yt_radio"],
      ["s2", "yt_radio"],
    ]);
    expect(puts[0].items[0].artists).toEqual([
      { id: "unknown", name: "A" },
      { id: "unknown", name: "B" },
    ]);
    expect(s.storage.getItem(POOL_KEY)).toBe(String(Date.now()));

    s.setBusy(true);
    s.setBusy(false);
    await advance(POOL_IDLE_MS + POOL_GAP_MS, 1000);
    expect(s.daemon.callsTo("GET", "/v1/recs/seeds?source=yt_radio")).toHaveLength(1);
    vi.setSystemTime(Date.now() + POOL_EVERY_MS);
    s.setBusy(true);
    s.setBusy(false);
    await advance(POOL_IDLE_MS, 1000);
    expect(s.daemon.callsTo("GET", "/v1/recs/seeds?source=yt_radio")).toHaveLength(2);
    s.refresher.dispose();
  });

  it("a last refresh stamped in the future (the clock jumped back) counts as due", async () => {
    const s = setup(["s1"]);
    s.setBusy(true);
    s.storage.setItem(POOL_KEY, String(Date.now() + 3 * POOL_EVERY_MS));
    s.setBusy(false);
    await advance(POOL_IDLE_MS, 1000);
    expect(s.daemon.callsTo("GET", "/v1/recs/seeds?source=yt_radio")).toHaveLength(1);
    s.refresher.dispose();
  });

  it("playback stops a run at once and the idle countdown starts over", async () => {
    const s = setup(["s1", "s2", "s3"]);
    await advance(POOL_IDLE_MS);
    expect(s.radioCalls).toEqual(["s1"]);
    s.setBusy(true);
    await advance(POOL_GAP_MS * 3, 1000);
    expect(s.radioCalls).toEqual(["s1"]);
    expect(s.storage.getItem(POOL_KEY)).toBeNull();
    s.setBusy(false);
    await advance(POOL_IDLE_MS);
    expect(s.daemon.callsTo("GET", "/v1/recs/seeds?source=yt_radio")).toHaveLength(2);
    s.refresher.dispose();
  });

  it("a failing seed is skipped; a day where nothing was stored stays open", async () => {
    const s = setup(["s1", "s2"], (id) => (id === "s1" ? new Error("offline") : [track("x")]));
    await advance(POOL_IDLE_MS + POOL_GAP_MS, 1000);
    expect(s.daemon.callsTo("PUT", "/v1/recs/pool").map((c) => JSON.parse(c.body!).seedId)).toEqual(["s2"]);
    expect(s.storage.getItem(POOL_KEY)).not.toBeNull();

    const down = setup(["s1"], () => new Error("offline"));
    await advance(POOL_IDLE_MS, 1000);
    expect(down.storage.getItem(POOL_KEY)).toBeNull();
    expect(down.deps.log).toHaveBeenCalled();
    s.refresher.dispose();
    down.refresher.dispose();
  });

  it("after the YouTube lists asks the daemon for SoundCloud related lists, 3 s apart, and rests the day on those alone", async () => {
    const s = setup([], undefined, ["s1", "sc:2"]);
    const posts = () => s.daemon.callsTo("POST", "/v1/recs/pool/sc-related").map((c) => JSON.parse(c.body!).seedId);
    await advance(POOL_IDLE_MS, 1000);
    expect(s.radioCalls).toEqual([]);
    expect(posts()).toEqual(["s1"]);
    await advance(POOL_GAP_MS, 1000);
    expect(posts()).toEqual(["s1", "sc:2"]);
    expect(s.storage.getItem(POOL_KEY)).not.toBeNull();
    s.refresher.dispose();
  });

  it("a SoundCloud outage keeps the YouTube lists and still rests the day", async () => {
    const s = setup(["y1"], undefined, ["s1"]);
    s.daemon.on("POST /v1/recs/pool/sc-related", () => new Response(null, { status: 503 }));
    await advance(POOL_IDLE_MS + POOL_GAP_MS, 1000);
    expect(s.daemon.callsTo("PUT", "/v1/recs/pool")).toHaveLength(1);
    expect(s.daemon.callsTo("POST", "/v1/recs/pool/sc-related")).toHaveLength(1);
    expect(s.storage.getItem(POOL_KEY)).not.toBeNull();
    s.refresher.dispose();
  });

  it("a daemon that cannot list SoundCloud seeds leaves the day open", async () => {
    const s = setup(["y1"]);
    s.daemon.on("GET /v1/recs/seeds", (_request, url) =>
      url.searchParams.get("source") === "sc_related" ? new Response(null, { status: 503 }) : Response.json({ seeds: ["y1"] }),
    );
    await advance(POOL_IDLE_MS, 1000);
    expect(s.daemon.callsTo("PUT", "/v1/recs/pool")).toHaveLength(1);
    expect(s.storage.getItem(POOL_KEY)).toBeNull();
    s.refresher.dispose();
  });

  it("while SoundCloud is down a failed run cools down 30 min, then doubles, instead of retrying every idle minute", async () => {
    const s = setup(["y1"], undefined, ["s1", "s2"]);
    s.daemon.on("POST /v1/recs/pool/sc-related", () => new Response(null, { status: 503 }));
    s.daemon.on("PUT /v1/recs/pool", () => new Response(null, { status: 503 }));
    const runs = () => s.daemon.callsTo("PUT", "/v1/recs/pool").length;
    const idleMinute = async () => {
      s.setBusy(true);
      s.setBusy(false);
      await advance(POOL_IDLE_MS + 2 * POOL_GAP_MS, 1000);
    };
    await advance(POOL_IDLE_MS + 2 * POOL_GAP_MS, 1000);
    expect(runs()).toBe(1);
    expect(s.daemon.callsTo("POST", "/v1/recs/pool/sc-related")).toHaveLength(2);

    await idleMinute();
    await advance(20 * 60_000, 60_000);
    await idleMinute();
    expect(runs()).toBe(1);

    await advance(10 * 60_000, 60_000);
    await idleMinute();
    expect(runs()).toBe(2);

    await advance(40 * 60_000, 60_000);
    await idleMinute();
    expect(runs()).toBe(2);
    await advance(30 * 60_000, 60_000);
    await idleMinute();
    expect(runs()).toBe(3);
    s.refresher.dispose();
  });

  it("a stored day clears the cooldown", async () => {
    const s = setup(["y1"], undefined, ["s1"]);
    s.daemon.on("POST /v1/recs/pool/sc-related", () => new Response(null, { status: 503 }));
    s.daemon.on("PUT /v1/recs/pool", () => new Response(null, { status: 503 }));
    await advance(POOL_IDLE_MS + POOL_GAP_MS, 1000);
    s.daemon.on("PUT /v1/recs/pool", () => new Response(null, { status: 204 }));
    await advance(31 * 60_000, 60_000);
    s.setBusy(true);
    s.setBusy(false);
    await advance(POOL_IDLE_MS + POOL_GAP_MS, 1000);
    expect(s.storage.getItem(POOL_KEY)).not.toBeNull();
    expect(s.storage.getItem("nuvo.recs.poolRetryAt")).toBeNull();
    s.refresher.dispose();
  });
});
