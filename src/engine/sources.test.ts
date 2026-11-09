import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { stateLine, STATE_LINE_EN, streamHover } from "./stateLine";
import { advance, createHarness, flush, track, urlSource, y, type Harness } from "./test/harness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const sc = (n: number, extra = {}) => track(`sc:${n}`, extra);
const scDescriptor = (url: string, extra: object = {}) =>
  new Response(
    JSON.stringify({
      kind: "direct",
      url,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      codec: "aac",
      mimeType: "audio/mp4",
      bitrate: 160_000,
      contentLength: 1000,
      ...extra,
    }),
    { status: 200 },
  );

async function start(h: Harness, t = track(y("t"))) {
  h.engine.playList([t, track(y("n"))]);
  await flush();
}

describe("resolution order", () => {
  it("a cached track plays the daemon URL with no resolve and no download", async () => {
    const h = createHarness();
    h.daemon.cached(y("t"));
    await start(h);
    expect(h.deck.loads[0].source.url).toBe(`nuvo-core://local/v1/cache/audio/${y("t")}`);
    expect(h.youtube.resolves).toEqual([]);
    expect(h.daemon.calls.filter((c) => c.method === "GET" && !c.headers.get("range") && c.path.startsWith("/v1/cache/audio"))).toEqual([]);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("a silent daemon never holds the network back past 1.5 s", async () => {
    const h = createHarness();
    h.daemon.on(
      `GET /v1/cache/audio/${y("t")}`,
      (request) => new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("t", "AbortError")))),
    );
    h.engine.playList([track(y("t"))]);
    await advance(1500);
    expect(h.youtube.resolves).toEqual([y("t")]);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("an empty cache entry is a miss and gets a fresh copy", async () => {
    const h = createHarness({ precache: true });
    h.daemon.on(`GET /v1/cache/audio/${y("t")}`, () => new Response(null, { status: 206, headers: { "content-range": "bytes 0-0/0" } }));
    await start(h);
    expect(h.youtube.resolves).toEqual([y("t")]);
    await flush();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toHaveLength(1);
  });

  it("an unreadable cached file is deleted and reloaded from the network once", async () => {
    const h = createHarness();
    h.daemon.cached(y("t"));
    h.daemon.on(`DELETE /v1/cache/audio/${y("t")}`, () => {
      h.daemon.on(`GET /v1/cache/audio/${y("t")}`, () => new Response(null, { status: 404 }));
      return new Response(null, { status: 204 });
    });
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 30_000 });
    h.deck.emit("error", { error: { code: 3 } });
    await flush();
    expect(h.daemon.callsTo("DELETE", `/v1/cache/audio/${y("t")}`)).toHaveLength(1);
    expect(h.deck.loads.at(-1)).toMatchObject({ positionMs: 30_000 });
    expect(h.deck.loads.at(-1)!.source.url).toContain("googlevideo");
    expect(h.engine.getView().status).toBe("playing");
    h.deck.emit("timeupdate", { positionMs: 31_000 });
    h.deck.emit("error", { error: { code: 2 } });
    await flush();
    expect(h.deck.loads.filter((l) => l.trackId === y("t") && l.source.url.includes("googlevideo"))).toHaveLength(1);
    expect(h.match.calls).toHaveLength(1);
  });

  it("the retry comes back 3 s past the recovery point", async () => {
    const h = createHarness();
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 40_000 });
    h.deck.emit("error", { error: { code: 2 } });
    await flush();
    const load = () => (h.engine as unknown as { load: { retryUsed: boolean } }).load;
    h.deck.emit("timeupdate", { positionMs: 42_000 });
    expect(load().retryUsed).toBe(true);
    h.deck.emit("timeupdate", { positionMs: 43_000 });
    expect(load().retryUsed).toBe(false);
  });

  it("YouTube tracks resolve progressively and attach the URL", async () => {
    const h = createHarness();
    const spy = vi.spyOn(h.youtube, "resolve");
    await start(h);
    expect(spy.mock.calls[0][1]).toEqual({ progressive: true, early: true, quality: "normal" });
    expect(h.deck.loads[0].source.url).toBe(`https://rr1.googlevideo.com/${y("t")}`);
  });

  it("an unavailable YouTube track goes to fallback with that cause", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unplayable");
    h.match.answers = [{ track: sc(1), score: 90 }];
    h.daemon.on("GET /v1/sc/tracks/1/stream", () => scDescriptor("https://cf-media.sndcdn.com/1"));
    await start(h);
    expect(h.engine.getView().fallback).toMatchObject({ cause: "unavailable", usedSource: "soundcloud" });
  });

  it("a direct SoundCloud URL counts as loaded until 15 s before expiry", async () => {
    const h = createHarness();
    h.daemon.on("GET /v1/sc/tracks/5/stream", () => scDescriptor("https://cf-media.sndcdn.com/5"));
    h.engine.playList([sc(5)]);
    await flush();
    expect(h.deck.loads[0].source.url).toBe("https://cf-media.sndcdn.com/5");
    const needsReload = () => (h.engine as unknown as { needsReload(): boolean }).needsReload();
    expect(needsReload()).toBe(false);
    vi.setSystemTime(Date.now() + 590_000);
    expect(needsReload()).toBe(true);
  });

  it("imported rows play the approved YouTube match; pending fails", async () => {
    const h = createHarness();
    h.match.answers = [{ track: track(y("m")), score: 88 }];
    h.engine.playList([track("spotify:1", { title: "Song" })]);
    await flush();
    expect(h.match.calls[0]).toMatchObject({ target: "youtube", id: "spotify:1" });
    expect(h.youtube.resolves).toEqual([y("m")]);

    const p = createHarness();
    p.match.answers = [];
    p.engine.playList([track("spotify:2"), track(y("b"))]);
    await advance(100);
    expect(p.reports[0]).toMatchObject({ endReason: "error", fallbackReason: "unavailable" });
  });

  it("a bytes source plays through an object URL and caches the same bytes", async () => {
    const h = createHarness({ precache: true });
    const bytes = new Blob([new Uint8Array([0x4f, 0x67, 0x67])], { type: "audio/ogg" });
    h.youtube.script.set(y("t"), async () => ({ bytes, mimeType: "audio/ogg", codec: "opus", bitrate: 128_000 }));
    await start(h);
    expect(h.deck.loads[0].source.url).toMatch(/^blob:/);
    await flush();
    const put = h.daemon.callsTo("PUT", `/v1/cache/audio/${y("t")}`);
    expect(put).toHaveLength(0);
    expect(h.youtube.resolves).toEqual([y("t")]);
  });

  it("a progressive overflow switches to the whole file in place", async () => {
    const h = createHarness();
    let finish!: (blob: Blob) => void;
    const whole = new Promise<Blob>((resolve) => (finish = resolve));
    const release = vi.fn();
    h.youtube.script.set(y("t"), async () => ({
      progressive: { url: "blob:progressive", whole, overflowed: () => true, release },
      mimeType: "audio/webm",
      codec: "opus",
      bitrate: 160_000,
    }));
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 95_000 });
    const statuses: string[] = [];
    h.engine.subscribe((v) => statuses.push(v.status));
    finish(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]));
    await flush();
    expect(h.deck.attachedUrl).toMatch(/^blob:/);
    expect(h.deck.attachedUrl).not.toBe("blob:progressive");
    expect(h.deck.position).toBe(95_000);
    expect(statuses.every((s) => s === "playing")).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it("the previous source stays attached until the next one resolves", async () => {
    const h = createHarness();
    h.youtube.script.set(y("a"), async () => ({ bytes: new Blob([new Uint8Array([1])]), mimeType: "audio/webm", codec: "opus", bitrate: 1 }));
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    const aUrl = h.deck.attachedUrl;
    const pending = h.youtube.pending(y("b"));
    h.engine.next();
    await flush();
    expect(h.deck.attachedUrl).toBe(aUrl);
    expect((h.engine as unknown as { needsReload(): boolean }).needsReload()).toBe(true);
    pending.resolve(urlSource("https://rr1.googlevideo.com/b"));
    await flush();
    expect(h.deck.attachedUrl).toBe("https://rr1.googlevideo.com/b");
  });
});

describe("cache writes", () => {
  it("a URL start hands the download to the daemon", async () => {
    const h = createHarness({ precache: true });
    await start(h);
    const post = h.daemon.callsTo("POST", "/v1/cache/fetch");
    expect(post).toHaveLength(1);
    expect(JSON.parse(post[0].body!)).toMatchObject({
      trackId: y("t"),
      url: `https://rr1.googlevideo.com/${y("t")}`,
      mime: "audio/webm",
      codec: "opus",
      bitrateKbps: 160,
    });
    expect(h.daemon.calls.filter((c) => c.path.includes("googlevideo"))).toEqual([]);
  });

  it("a save can cache a track outside the next-track slot", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("q"));
    expect(await h.precache!.ensureCached(track(y("q")), new AbortController().signal)).toBe(true);
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
    expect(h.youtube.resolves).toEqual([]);
  });

  it("tracks over 20 minutes are not cached in the background", async () => {
    const h = createHarness({ precache: true });
    await start(h, track(y("t"), { durationMs: 25 * 60_000 }));
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
  });

  it("clearing the cache drops a write in progress", async () => {
    const h = createHarness({ precache: true });
    let finish!: (blob: Blob) => void;
    const whole = new Promise<Blob>((resolve) => (finish = resolve));
    h.youtube.script.set(y("t"), async () => ({
      progressive: { url: "blob:p", whole, overflowed: () => false, release: () => undefined },
      mimeType: "audio/webm",
      codec: "opus",
      bitrate: 160_000,
    }));
    await start(h);
    h.engine.cacheCleared();
    finish(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]));
    await flush();
    expect(h.daemon.callsTo("PUT", "/v1/cache/audio")).toEqual([]);
  });
});

describe("fallback", () => {
  const withScAlternative = (h: Harness) => {
    h.match.answers = [{ track: sc(7, { durationMs: 200_000 }), score: 91 }];
    h.daemon.on("GET /v1/sc/tracks/7/stream", () => scDescriptor("https://cf-media.sndcdn.com/7"));
  };

  it("every trigger starts fallback with its cause", async () => {
    const cases: Array<[string, (h: Harness) => Promise<void>, string]> = [
      [
        "blocked",
        async (h) => {
          h.youtube.fail(y("t"), "unreachable");
          await start(h);
        },
        "blocked",
      ],
      [
        "timeout",
        async (h) => {
          h.youtube.fail(y("t"), "worker-timeout");
          await start(h);
        },
        "timeout",
      ],
      [
        "network",
        async (h) => {
          await start(h);
          h.deck.emit("error", { error: { code: 2 } });
          await flush();
          h.deck.emit("error", { error: { code: 2 } });
          await flush();
        },
        "media_error",
      ],
      [
        "not supported",
        async (h) => {
          await start(h);
          h.deck.emit("error", { error: { code: 4 } });
          await flush();
          h.deck.emit("error", { error: { code: 4 } });
          await flush();
        },
        "media_error",
      ],
      [
        "403",
        async (h) => {
          await start(h);
          h.deck.emit("error", { error: { code: 2, httpStatus: 403 } });
          await flush();
        },
        "http_403",
      ],
      [
        "stall",
        async (h) => {
          await start(h);
          await advance(8100, 100);
        },
        "stall",
      ],
    ];
    for (const [, run, cause] of cases) {
      const h = createHarness();
      withScAlternative(h);
      await run(h);
      expect(h.engine.getView().fallback?.cause).toBe(cause);
    }
  });

  it("offline and a user pause never search", async () => {
    const h = createHarness({ online: false });
    withScAlternative(h);
    h.youtube.fail(y("t"), "unreachable");
    await start(h);
    expect(h.match.calls).toEqual([]);
    const p = createHarness();
    withScAlternative(p);
    p.youtube.pending(y("t"));
    p.engine.playList([track(y("t"))]);
    p.engine.pause();
    await advance(20_000, 500);
    expect(p.match.calls).toEqual([]);
  });

  it("a remembered alternative plays without a search", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unreachable");
    h.daemon.on(`GET /v1/tracks/${y("t")}/alternative`, () => Response.json({ source: "soundcloud", altId: "sc:7", score: 90, reason: "timeout" }));
    h.daemon.on("GET /v1/sc/tracks/7/stream", () => scDescriptor("https://cf-media.sndcdn.com/7"));
    await start(h);
    expect(h.deck.loads[0].source.url).toBe("https://cf-media.sndcdn.com/7");
    expect(h.match.calls).toEqual([]);
  });

  it("only approved matches play", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unplayable");
    h.match.answers = [];
    h.engine.playList([track(y("t")), track(y("n"))]);
    await advance(100);
    expect(h.match.calls[0].target).toBe("soundcloud");
    expect(h.deck.loads.every((l) => l.trackId !== y("t"))).toBe(true);
  });

  it("two failed alternatives fail the start with an error report", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unplayable");
    h.daemon.on(`GET /v1/tracks/${y("t")}/alternative`, () => Response.json({ source: "soundcloud", altId: "sc:7", score: 90, reason: "timeout" }));
    h.daemon.on("GET /v1/sc/tracks/7/stream", () => new Response(null, { status: 404 }));
    h.daemon.on("GET /v1/sc/tracks/8/stream", () => new Response(null, { status: 404 }));
    h.match.answers = [{ track: sc(8), score: 80 }];
    h.engine.playList([track(y("t")), track(y("n"))]);
    await advance(100);
    expect(h.reports[0]).toMatchObject({ endReason: "error", source: "youtube", fallbackReason: "unavailable" });
    expect(h.engine.getView().current?.track.id).toBe(y("n"));
  });

  it("the same position when lengths agree within 3 s, else a restart", async () => {
    for (const [extra, expected] of [
      [2000, { startAtMs: 70_000, restarted: false }],
      [5000, { startAtMs: 0, restarted: true }],
    ] as const) {
      const h = createHarness();
      h.match.answers = [{ track: sc(7, { durationMs: 200_000 + extra }), score: 91 }];
      h.daemon.on("GET /v1/sc/tracks/7/stream", () => scDescriptor("https://cf-media.sndcdn.com/7"));
      await start(h);
      h.deck.emit("timeupdate", { positionMs: 70_000 });
      h.deck.emit("error", { error: { code: 2, httpStatus: 403 } });
      await flush();
      expect(h.deck.loads.at(-1)!.positionMs).toBe(expected.startAtMs);
      expect(h.engine.getView().fallback?.restarted).toBe(expected.restarted);
    }
  });

  it("a working alternative is remembered; its reason decides the order next time", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unplayable");
    withScAlternative(h);
    await start(h);
    const put = h.daemon.callsTo("PUT", `/v1/tracks/${y("t")}/alternative`);
    expect(JSON.parse(put[0].body!)).toEqual({ source: "soundcloud", altId: "sc:7", score: 91, reason: "unavailable", durationMs: 200_000 });

    const lasting = createHarness();
    lasting.daemon.on(`GET /v1/tracks/${y("t")}/alternative`, () => Response.json({ source: "soundcloud", altId: "sc:7", score: 91, reason: "unavailable" }));
    lasting.daemon.on("GET /v1/sc/tracks/7/stream", () => scDescriptor("https://cf-media.sndcdn.com/7"));
    await start(lasting);
    expect(lasting.youtube.resolves.filter((id) => id === y("t"))).toEqual([]);
    expect(lasting.match.calls).toEqual([]);

    const passing = createHarness();
    passing.daemon.on(`GET /v1/tracks/${y("t")}/alternative`, () => Response.json({ source: "soundcloud", altId: "sc:7", score: 91, reason: "timeout" }));
    passing.daemon.on("GET /v1/sc/tracks/7/stream", () => scDescriptor("https://cf-media.sndcdn.com/7"));
    passing.youtube.fail(y("t"), "worker-timeout");
    await start(passing);
    expect(passing.youtube.resolves[0]).toBe(y("t"));
    expect(passing.deck.loads[0].source.url).toBe("https://cf-media.sndcdn.com/7");
    expect(passing.match.calls).toEqual([]);
  });

  it("rejecting the alternative tries YouTube first, then the next candidate", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unplayable");
    withScAlternative(h);
    await start(h);
    await h.engine.rejectAlternative(y("t"));
    expect(JSON.parse(h.daemon.callsTo("POST", `/v1/tracks/${y("t")}/alternative/reject`)[0].body!)).toEqual({ altId: "sc:7" });
    h.match.answers = [
      { track: sc(7), score: 91 },
      { track: sc(9), score: 85 },
    ];
    h.daemon.on("GET /v1/sc/tracks/9/stream", () => scDescriptor("https://cf-media.sndcdn.com/9"));
    h.engine.playEntry(h.engine.getView().entries[0].entryId);
    await flush();
    expect(h.youtube.resolves.filter((id) => id === y("t"))).toHaveLength(2);
    expect(h.deck.loads.at(-1)!.source.url).toBe("https://cf-media.sndcdn.com/9");
  });

  it("the view and the state line name the fallback", async () => {
    const h = createHarness();
    h.youtube.fail(y("t"), "unplayable");
    withScAlternative(h);
    await start(h);
    const view = h.engine.getView();
    expect(view.fallback).toEqual({ primarySource: "youtube", usedSource: "soundcloud", cause: "unavailable", score: 91, restarted: false });
    const line = stateLine(view)!;
    expect(line.key).toBe("playedFrom");
    expect(STATE_LINE_EN[line.key](line.params)).toBe("Played from SoundCloud");
  });
});

describe("best quality and readout", () => {
  it("normal mode plays the cache", async () => {
    const h = createHarness();
    h.daemon.cached(y("t"), { "x-nuvo-bitrate": "128", "x-nuvo-codec": "opus" });
    await start(h);
    expect(h.engine.getView().stream).toMatchObject({ fromCache: true, bitrateKbps: 128 });
  });

  it("best quality picks the higher bitrate, Opus on a tie", async () => {
    for (const [aac, expected] of [
      [160_000, "soundcloud"],
      [160_000, "youtube"],
    ] as const) {
      const h = createHarness();
      h.engine.setBestQuality(true);
      const ytBitrate = expected === "soundcloud" ? 128_000 : 160_000;
      h.youtube.script.set(y("t"), async () => urlSource("https://rr1.googlevideo.com/t", { bitrate: ytBitrate }));
      h.match.answers = [{ track: sc(7), score: 90 }];
      h.daemon.on("GET /v1/sc/tracks/7/stream", () => scDescriptor("https://cf-media.sndcdn.com/7", { bitrate: aac }));
      await start(h);
      expect(h.engine.getView().stream?.source).toBe(expected);
    }
  });

  it("best quality skips a weaker cached copy and replaces it", async () => {
    const h = createHarness({ precache: true });
    h.engine.setBestQuality(true);
    h.daemon.cached(y("t"), { "x-nuvo-bitrate": "64" });
    await start(h);
    expect(h.engine.getView().stream).toMatchObject({ source: "youtube", bitrateKbps: 160 });
    expect(JSON.parse(h.daemon.callsTo("POST", "/v1/cache/fetch")[0].body!).bitrateKbps).toBe(160);
  });

  it("hover text for cached and network plays", () => {
    expect(streamHover({ source: "cache", codec: "opus", bitrateKbps: 160, fromCache: true })).toBe("Opus · 160 kbps · from cache");
    expect(streamHover({ source: "youtube", codec: "opus", bitrateKbps: Math.round(129_600 / 1000), fromCache: false })).toBe("Opus · 130 kbps · YouTube");
  });

  it("the device pause outranks the best-quality line", async () => {
    const h = createHarness();
    h.engine.setBestQuality(true);
    await start(h);
    h.engine.pauseFor("device_lost");
    expect(stateLine(h.engine.getView())?.key).toBe("deviceLost");
    h.engine.play();
    await flush();
    const line = stateLine(h.engine.getView())!;
    expect(STATE_LINE_EN[line.key](line.params)).toBe("Best quality · Opus 160");
  });
});

describe("pre-cache", () => {
  async function steady(h: Harness, ms: number) {
    for (let t = 250; t <= ms; t += 250) {
      await vi.advanceTimersByTimeAsync(250);
      h.deck.emit("timeupdate", { positionMs: t });
    }
    await flush();
  }

  it("the job starts at 10 s of steady play", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t"));
    await start(h);
    await steady(h, 9750);
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
    await steady(h, 250);
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await flush();
    expect(JSON.parse(h.daemon.callsTo("POST", "/v1/cache/fetch")[0].body!).trackId).toBe(y("n"));
  });

  it("a seek restarts the 10 s count", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t"));
    await start(h);
    await steady(h, 6000);
    h.engine.seekTo(100_000);
    h.deck.emit("timeupdate", { positionMs: 100_000 });
    h.deck.emit("timeupdate", { positionMs: 105_000 });
    await flush();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
    h.deck.emit("timeupdate", { positionMs: 110_000 });
    await flush();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toHaveLength(1);
  });

  it("a queue change cancels the running job", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t"));
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => Response.json({ state: "fetching", bytes: 10 }));
    h.engine.playList([track(y("t")), track(y("b")), track(y("c"))]);
    await flush();
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await flush();
    h.engine.move(h.engine.getView().entries[2].entryId, 1);
    await flush();
    expect(h.daemon.callsTo("DELETE", `/v1/cache/fetch/${y("b")}`)).toHaveLength(1);
    h.deck.emit("timeupdate", { positionMs: 10_250 });
    await flush();
    expect(JSON.parse(h.daemon.callsTo("POST", "/v1/cache/fetch").at(-1)!.body!).trackId).toBe(y("c"));
  });

  it("nothing for a cached next entry, and one job at a time", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t")).cached(y("n"));
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await flush();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
  });

  it("a running job blocks a second one, and a finished one is not repeated", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t"));
    let state = "fetching";
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => Response.json({ state, bytes: 1 }));
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await flush();
    for (let t = 10_250; t < 12_000; t += 250) h.deck.emit("timeupdate", { positionMs: t });
    await flush();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toHaveLength(1);
    state = "done";
    await advance(2100);
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toHaveLength(1);
  });

  it("a bytes source goes up by PUT and is dropped after", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t"));
    const bytes = new Blob([new Uint8Array([0x4f, 0x67, 0x67, 0x53])], { type: "audio/ogg" });
    h.youtube.script.set(y("n"), async () => ({ bytes, mimeType: "audio/ogg", codec: "opus", bitrate: 128_000 }));
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await flush();
    expect(h.daemon.callsTo("PUT", `/v1/cache/audio/${y("n")}`)[0].body).toBe("blob:4");
    expect(h.precache!.heldBlob).toBeNull();
  });

  it("path A failing as unavailable falls back to path B", async () => {
    const h = createHarness({ precache: true });
    h.daemon.cached(y("t"));
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => Response.json({ state: "failed", bytes: 0, code: "unavailable" }));
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await advance(2100);
    expect(h.daemon.callsTo("PUT", `/v1/cache/audio/${y("n")}`)).toHaveLength(1);
  });

  it("idle prefetch caches kept tracks one at a time and stops on play", async () => {
    const h = createHarness({ precache: true });
    const kept = [track(y("k")), track(y("l"))];
    let served = 0;
    h.daemon.on("GET /v1/cache/missing", () => Response.json({ items: kept.slice(served) }));
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => {
      served += 1;
      return Response.json({ state: "done", bytes: 10 });
    });
    h.engine.playList([track(y("t"))]);
    await flush();
    h.engine.pause();
    await advance(30_000, 1000);
    await advance(2100);
    expect(JSON.parse(h.daemon.callsTo("POST", "/v1/cache/fetch").at(-1)!.body!).trackId).toBe(y("l"));
    h.engine.play();
    await advance(5000);
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch").filter((c) => JSON.parse(c.body!).trackId === y("l"))).toHaveLength(1);
  });

  it("cancelAll while paused cancels the armed idle timer", async () => {
    const h = createHarness({ precache: true });
    h.daemon.on("GET /v1/cache/missing", () => Response.json({ items: [track(y("k"))] }));
    h.engine.playList([track(y("t"))]);
    await flush();
    h.engine.pause();
    await advance(10_000, 1000);
    h.precache!.cancelAll();
    await advance(40_000, 1000);
    expect(h.daemon.callsTo("GET", "/v1/cache/missing")).toEqual([]);
  });

  it("after dispose a status change arms nothing", async () => {
    const h = createHarness({ precache: true });
    h.daemon.on("GET /v1/cache/missing", () => Response.json({ items: [track(y("k"))] }));
    h.precache!.dispose();
    h.precache!.statusChanged("paused");
    await advance(40_000, 1000);
    expect(h.daemon.callsTo("GET", "/v1/cache/missing")).toEqual([]);
  });

  it("a track that failed within the hour is skipped", async () => {
    const h = createHarness({ precache: true });
    const asked: string[] = [];
    h.daemon.on("GET /v1/cache/missing", (_r, url) => {
      asked.push(url.search);
      return Response.json({ items: [track(y("k"))] });
    });
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => Response.json({ state: "failed", bytes: 0, code: "server_error" }));
    h.engine.playList([track(y("t"))]);
    await flush();
    h.engine.pause();
    await advance(32_500, 500);
    expect(asked.at(-1)).toBe("?limit=2");
    vi.setSystemTime(Date.now() + 3600_000);
    h.engine.play();
    await flush();
    h.engine.pause();
    await advance(30_500, 500);
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch").filter((c) => JSON.parse(c.body!).trackId === y("k"))).toHaveLength(2);
  });
});

describe("review focus", () => {
  it("a starting daemon (503 everywhere) never blocks playback", async () => {
    const h = createHarness({ precache: true });
    const starting = () => new Response(JSON.stringify({ message: "starting", code: "CORE_STARTING", reqId: "" }), { status: 503 });
    for (const prefix of ["GET /v1/cache/audio/", "GET /v1/tracks/", "PUT /v1/tracks/", "DELETE /v1/cache/", "PUT /v1/cache/audio/"])
      h.daemon.onPrefix(prefix, starting);
    h.daemon.on("POST /v1/cache/fetch", starting);
    h.daemon.on("POST /v1/me/playback/events", starting);
    await start(h);
    expect(h.engine.getView().status).toBe("playing");
    expect(h.deck.loads[0].source.url).toBe(`https://rr1.googlevideo.com/${y("t")}`);
  });

  async function armNext(h: Harness) {
    h.daemon.cached(y("t"));
    await start(h);
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
  }

  it("a status poll that cannot reach the daemon is retried, a 404 ends the job", async () => {
    for (const [answers, puts, polls, cachedAfter] of [
      [[0, 503, 200], 0, 3, true],
      [[404], 0, 1, false],
      [[0, 503, 0], 0, 3, false],
    ] as const) {
      const h = createHarness({ precache: true });
      let i = 0;
      h.daemon.onPrefix("GET /v1/cache/fetch/", () => {
        const http = answers[Math.min(i++, answers.length - 1)];
        return http === 200 ? Response.json({ state: "done", bytes: 10 }) : new Response(null, { status: http });
      });
      await armNext(h);
      for (let t = 0; t < 10_000; t += 500) {
        h.deck.emit("timeupdate", { positionMs: 41_000 + t });
        await advance(500, 500);
      }
      expect(i).toBe(polls);
      expect(h.daemon.callsTo("PUT", `/v1/cache/audio/${y("n")}`)).toHaveLength(puts);
      expect(h.resolver.isKnownCached(y("n"))).toBe(cachedAfter);
    }
  });

  it("a failed next-track job is not restarted on every tick", async () => {
    const h = createHarness({ precache: true });
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => Response.json({ state: "failed", bytes: 0, code: "server_error" }));
    await armNext(h);
    await advance(2100);
    for (let t = 10_250; t < 20_000; t += 250) {
      await vi.advanceTimersByTimeAsync(250);
      h.deck.emit("timeupdate", { positionMs: t });
    }
    await flush();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toHaveLength(1);
    expect(h.youtube.resolves.filter((id) => id === y("n"))).toHaveLength(1);
  });

  it("a cancel waits for a pending job start so no daemon job is orphaned", async () => {
    const h = createHarness({ precache: true });
    h.engine.playList([track(y("t")), track(y("b")), track(y("c"))]);
    await flush();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.daemon.on("POST /v1/cache/fetch", async () => {
      await gate;
      return new Response(null, { status: 202 });
    });
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await flush();
    h.engine.move(h.engine.getView().entries[2].entryId, 1);
    await flush();
    expect(h.daemon.callsTo("DELETE", `/v1/cache/fetch/${y("b")}`)).toHaveLength(0);
    release();
    await flush();
    expect(h.daemon.callsTo("DELETE", `/v1/cache/fetch/${y("b")}`)).toHaveLength(1);
  });

  it("a cancel during the poll stops polling", async () => {
    const h = createHarness({ precache: true });
    h.engine.playList([track(y("t")), track(y("b")), track(y("c"))]);
    await flush();
    h.daemon.onPrefix("GET /v1/cache/fetch/", () => Response.json({ state: "fetching", bytes: 1 }));
    h.deck.emit("timeupdate", { positionMs: 0 });
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    await advance(2100);
    const polls = () => h.daemon.callsTo("GET", `/v1/cache/fetch/${y("b")}`).length;
    expect(polls()).toBeGreaterThan(0);
    h.engine.move(h.engine.getView().entries[2].entryId, 1);
    await flush();
    const before = polls();
    await advance(10_000, 500);
    expect(polls()).toBe(before);
  });
});

describe("early start", () => {
  const url = `https://rr1.googlevideo.com/${y("t")}`;
  type Source = ReturnType<typeof urlSource>;
  function earlyStart(h: Harness) {
    const probe = { runs: 0, pass: (_source: Source) => undefined as void, fail: (_error: unknown) => undefined as void };
    const verify = () => {
      probe.runs += 1;
      return new Promise<Source>((pass, fail) => Object.assign(probe, { pass, fail }));
    };
    h.youtube.script.set(y("t"), async () => urlSource(url, { verify }));
    return probe;
  }

  it("plays before the probe, probes once the stream plays, then reports the stream and hands the URL to the daemon", async () => {
    const h = createHarness({ precache: true });
    const probe = earlyStart(h);
    await start(h);
    expect(h.youtube.early).toEqual([true]);
    expect(h.engine.getView().status).toBe("playing");
    expect(probe.runs).toBe(1);
    expect(h.engine.getView().stream).toBeNull();
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
    probe.pass(urlSource(url));
    await flush();
    expect(h.engine.getView().stream).toMatchObject({ source: "youtube", codec: "opus" });
    expect(h.deck.loads).toHaveLength(1);
    expect(JSON.parse(h.daemon.callsTo("POST", "/v1/cache/fetch")[0].body!)).toMatchObject({ url });
  });

  it("the probe waits for the stream to answer", async () => {
    const h = createHarness();
    h.deck.autoPlaying = false;
    const probe = earlyStart(h);
    await start(h);
    expect(probe.runs).toBe(0);
    h.deck.emit("playing");
    expect(probe.runs).toBe(1);
  });

  it("a replacement source after a failed probe is swapped in without a new load", async () => {
    const h = createHarness({ precache: true });
    const probe = earlyStart(h);
    await start(h);
    probe.pass(urlSource("https://rr2.googlevideo.com/other", { codec: "aac", bitrate: 128_000 }));
    await flush();
    expect(h.deck.loads).toHaveLength(1);
    expect(h.deck.attachedUrl).toBe("https://rr2.googlevideo.com/other");
    expect(h.engine.getView().stream).toMatchObject({ codec: "aac", bitrateKbps: 128 });
    expect(JSON.parse(h.daemon.callsTo("POST", "/v1/cache/fetch")[0].body!)).toMatchObject({ url: "https://rr2.googlevideo.com/other" });
  });

  it("no source after the probe is a media error: one retry with a new resolve", async () => {
    const h = createHarness();
    const probe = earlyStart(h);
    await start(h);
    h.youtube.script.delete(y("t"));
    probe.fail({ code: "all-failed" });
    await flush();
    expect(h.youtube.resolves).toEqual([y("t"), y("t")]);
    expect(h.deck.loads).toHaveLength(2);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("a deck error before the stream played starts the probe; its replacement gets a fresh load", async () => {
    const h = createHarness();
    h.deck.autoPlaying = false;
    const probe = earlyStart(h);
    await start(h);
    h.deck.emit("error", { error: { code: 2 } });
    expect(probe.runs).toBe(1);
    h.deck.autoPlaying = true;
    probe.pass(urlSource("https://rr2.googlevideo.com/other"));
    await flush();
    expect(h.youtube.resolves).toHaveLength(1);
    expect(h.deck.loads.map((load) => load.source.url)).toEqual([url, "https://rr2.googlevideo.com/other"]);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("a deck error while the probe runs waits for it; a passing probe then recovers as usual", async () => {
    const h = createHarness();
    const probe = earlyStart(h);
    await start(h);
    h.deck.emit("error", { error: { code: 2 } });
    await flush();
    expect(h.youtube.resolves).toHaveLength(1);
    h.youtube.script.delete(y("t"));
    probe.pass(urlSource(url));
    await flush();
    expect(h.youtube.resolves).toHaveLength(2);
    expect(h.deck.loads).toHaveLength(2);
  });

  it("a late answer for a start that moved on changes nothing", async () => {
    const h = createHarness();
    const probe = earlyStart(h);
    await start(h);
    h.engine.next();
    await flush();
    probe.pass(urlSource("https://rr2.googlevideo.com/other"));
    await flush();
    expect(h.deck.attachedUrl).toBe(`https://rr1.googlevideo.com/${y("n")}`);
  });

  it("best quality waits for the probe", async () => {
    const h = createHarness({ precache: true });
    h.engine.setBestQuality(true);
    await start(h);
    expect(h.youtube.early).toEqual([false]);
  });
});
