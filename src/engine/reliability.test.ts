import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESOLVE_MS, RETRY_AFTER_MS, START_BUDGET_MS, STALL_MS } from "./engine";
import { advance, createHarness, flush, track, urlSource, y, type Harness } from "./test/harness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const scDescriptor = (url: string) =>
  new Response(
    JSON.stringify({
      kind: "direct",
      url,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      codec: "aac",
      mimeType: "audio/mp4",
      bitrate: 160_000,
      contentLength: 1000,
    }),
    { status: 200 },
  );

const withSoundcloud = (h: Harness, n = 7) => {
  h.match.answers = [{ track: track(`sc:${n}`, { durationMs: 200_000 }), score: 91 }];
  h.daemon.on(`GET /v1/sc/tracks/${n}/stream`, () => scDescriptor(`https://cf-media.sndcdn.com/${n}`));
};

const view = (h: Harness) => h.engine.getView();

describe("the start watchdog", () => {
  it("a resolve that never answers moves to the next source inside its budget", async () => {
    const h = createHarness();
    withSoundcloud(h);
    h.youtube.pending(y("a"));
    h.engine.playList([track(y("a"))]);
    await advance(RESOLVE_MS + 100, 100);
    expect(view(h).status).toBe("playing");
    expect(view(h).stream?.source).toBe("soundcloud");
    expect(view(h).fallback?.cause).toBe("timeout");
  });

  it("a stream whose play() never settles is a stall, not a hang", async () => {
    const h = createHarness();
    withSoundcloud(h);
    h.deck.hangNext = true;
    h.engine.playList([track(y("a"))]);
    await advance(STALL_MS + 100, 100);
    expect(view(h).status).toBe("playing");
    expect(view(h).fallback?.cause).toBe("stall");
  });

  it("everything hanging skips the track when the start budget ends, and the queue goes on", async () => {
    const h = createHarness();
    h.youtube.pending(y("a"));
    h.match.approvedOn = () => new Promise(() => undefined);
    h.engine.playList([track(y("a")), track(y("b"))]);
    await advance(START_BUDGET_MS + 100, 100);
    expect(view(h).current?.track.id).toBe(y("b"));
    expect(view(h).status).toBe("playing");
    expect(view(h).notice).toMatchObject({ kind: "skipped", title: `Title ${y("a")}` });
  });

  it("alternatives that stall are not tried twice", async () => {
    const h = createHarness();
    h.deck.autoPlaying = false;
    h.match.approvedOn = async (_target, _track, _signal, exclude) => {
      const left = [1, 2].find((n) => !exclude?.has(`sc:${n}`));
      return left ? { track: track(`sc:${left}`, { durationMs: 200_000 }), score: 91 } : null;
    };
    for (const n of [1, 2]) h.daemon.on(`GET /v1/sc/tracks/${n}/stream`, () => scDescriptor(`https://cf-media.sndcdn.com/${n}`));
    h.engine.playList([track(y("a")), track(y("b"))]);
    await advance(START_BUDGET_MS + 100, 100);
    const urls = h.deck.loads.filter((l) => l.trackId === y("a")).map((l) => l.source.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(view(h).current?.track.id).toBe(y("b"));
  });
});

describe("a start on its way", () => {
  it("no track is prepared until it plays, so the old track's end cannot jump over it", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    expect(h.deck.candidate?.trackId).toBe(y("b"));
    const pending = h.youtube.pending(y("c"));
    h.engine.playList([track(y("c")), track(y("d"))]);
    await flush();
    expect(h.deck.candidate).toBeNull();
    pending.resolve(urlSource("https://rr1.googlevideo.com/c"));
    await flush();
    expect(view(h).status).toBe("playing");
    expect(h.deck.candidate?.trackId).toBe(y("d"));
  });
});

describe("mid-track stalls", () => {
  const playingAt = async (h: Harness, positionMs: number) => {
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    h.deck.emit("timeupdate", { positionMs });
    await flush();
  };

  it("no progress for the stall window moves on at the same position", async () => {
    const h = createHarness();
    withSoundcloud(h);
    await playingAt(h, 60_000);
    h.deck.emit("waiting");
    await advance(STALL_MS + 100, 100);
    expect(view(h).status).toBe("playing");
    expect(h.deck.loads.at(-1)?.positionMs).toBe(60_000);
    expect(h.deck.loads.length).toBe(2);
  });

  it("a backward seek is progress, not a stall", async () => {
    const h = createHarness();
    await playingAt(h, 60_000);
    for (let at = 10_000; at < 30_000; at += 2000) {
      h.deck.emit("timeupdate", { positionMs: at });
      await advance(2000, 500);
    }
    expect(h.deck.loads).toHaveLength(1);
  });

  it("a pause holds the watchdog and play arms it again", async () => {
    const h = createHarness();
    withSoundcloud(h);
    await playingAt(h, 60_000);
    h.engine.pause();
    h.deck.emit("pause");
    await advance(STALL_MS * 2, 500);
    expect(h.deck.loads).toHaveLength(1);
    h.engine.play();
    await flush();
    await advance(STALL_MS + 100, 100);
    expect(h.deck.loads).toHaveLength(2);
  });

  it("the track after a prepared switch is watched too", async () => {
    const h = createHarness();
    withSoundcloud(h);
    await playingAt(h, 60_000);
    const next = view(h).entries[1];
    h.deck.fireSwitch(next.entryId, 0);
    await flush();
    await advance(STALL_MS + 100, 100);
    expect(h.deck.loads).toHaveLength(2);
  });
});

describe("other YouTube clients first", () => {
  it("a refused stream asks for another client and keeps the same recording", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a"))]);
    await flush();
    h.youtube.script.set(y("a"), async () => urlSource("https://rr2.googlevideo.com/other", { servedBy: "VISIONOS" }));
    h.deck.emit("timeupdate", { positionMs: 42_000 });
    h.deck.emit("error", { error: { code: 2, httpStatus: 403 } });
    await flush();
    expect(h.youtube.avoided.at(-1)).toEqual(["WEB_REMIX"]);
    expect(h.deck.attachedUrl).toBe("https://rr2.googlevideo.com/other");
    expect(h.deck.loads.at(-1)?.positionMs).toBe(42_000);
    expect(view(h).fallback).toBeNull();
    expect(h.match.calls).toEqual([]);
  });

  it("when no other client answers the SoundCloud match plays", async () => {
    const h = createHarness();
    withSoundcloud(h);
    h.engine.playList([track(y("a"))]);
    await flush();
    h.youtube.fail(y("a"), "all-failed");
    h.deck.emit("error", { error: { code: 2, httpStatus: 403 } });
    await flush();
    expect(view(h).stream?.source).toBe("soundcloud");
    expect(view(h).fallback?.cause).toBe("http_403");
  });
});

describe("failed tracks", () => {
  it("are retried once at the end of the queue, last in line", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "unplayable");
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    expect(view(h).current?.track.id).toBe(y("b"));
    h.youtube.script.delete(y("a"));
    vi.setSystemTime(Date.now() + RETRY_AFTER_MS + 100);
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    await advance(500);
    expect(view(h).current?.track.id).toBe(y("a"));
    expect(view(h).status).toBe("playing");
    expect(view(h).entries.map((e) => e.track.id)).toEqual([y("b"), y("a")]);
  });

  it("a second failure ends the queue instead of looping", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "unplayable");
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    vi.setSystemTime(Date.now() + RETRY_AFTER_MS + 100);
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    await advance(500);
    expect(view(h).status).toBe("idle");
    expect(h.youtube.resolves.filter((id) => id === y("a"))).toHaveLength(2);
  });

  it("one that failed a moment ago is not retried yet", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "unplayable");
    h.engine.playList([track(y("a"))]);
    await advance(500);
    expect(h.youtube.resolves).toEqual([y("a")]);
    expect(view(h).status).toBe("idle");
  });
});

describe("network loss", () => {
  it("a stall while offline holds the position and plays on when the network returns", async () => {
    let online = true;
    const h = createHarness();
    h.deps.online = () => online;
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    h.deck.emit("timeupdate", { positionMs: 60_000 });
    online = false;
    h.deck.emit("waiting");
    await advance(STALL_MS + 100, 100);
    expect(view(h).status).toBe("paused");
    expect(view(h).pauseReason).toBe("network");
    expect(view(h).positionMs).toBe(60_000);
    online = true;
    h.engine.networkChanged();
    await flush();
    expect(view(h).status).toBe("playing");
    expect(view(h).current?.track.id).toBe(y("a"));
    expect(h.deck.loads.at(-1)?.positionMs).toBe(60_000);
  });

  it("a stop on the network drops the prepared next track", async () => {
    const h = createHarness();
    for (const l of ["a", "b", "c"]) h.youtube.fail(y(l), "worker-timeout");
    h.engine.playList(["a", "b", "c", "d", "e"].map((l) => track(y(l))));
    await advance(1000);
    expect(view(h).pauseReason).toBe("network");
    expect(h.deck.candidate).toBeNull();
  });

  it("a user pause stays a pause when the network changes", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a"))]);
    await flush();
    h.engine.pause();
    h.deck.emit("pause");
    await flush();
    h.engine.networkChanged();
    await flush();
    expect(view(h).status).toBe("paused");
    expect(h.deck.loads).toHaveLength(1);
  });

  it("a queue stopped on network failures starts again on its own", async () => {
    const h = createHarness();
    for (const l of ["a", "b", "c"]) h.youtube.fail(y(l), "worker-timeout");
    h.engine.playList(["a", "b", "c", "d"].map((l) => track(y(l))));
    await advance(1000);
    expect(view(h).pauseReason).toBe("network");
    h.engine.networkChanged();
    await flush();
    expect(view(h).status).toBe("playing");
    expect(view(h).current?.track.id).toBe(y("d"));
  });

  it("a queue that failed entirely plays again after the network changed", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "unplayable");
    h.engine.playList([track(y("a"))]);
    await advance(500);
    expect(view(h).notice).toMatchObject({ kind: "queue_failed" });
    h.youtube.script.delete(y("a"));
    h.engine.networkChanged();
    await flush();
    expect(view(h).status).toBe("playing");
    expect(view(h).notice).toBeNull();
  });
});

describe("a blocked source", () => {
  it("after two blocked starts the next one skips YouTube at once, until the network changes", async () => {
    const h = createHarness();
    withSoundcloud(h);
    h.youtube.fail(y("a"), "unreachable");
    h.youtube.fail(y("b"), "unreachable");
    h.engine.playList([track(y("a"))]);
    await flush();
    h.engine.playList([track(y("b"))]);
    await flush();
    h.engine.playList([track(y("c"))]);
    await flush();
    expect(h.youtube.resolves).toEqual([y("a"), y("b")]);
    expect(view(h).stream?.source).toBe("soundcloud");
    h.engine.networkChanged();
    h.engine.playList([track(y("d"))]);
    await flush();
    expect(h.youtube.resolves).toContain(y("d"));
  });

  it("no client getting an answer is a closed network, not a missing video", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "all-failed", { attempts: [{ code: "unreachable" }, { code: "paused" }, { code: "worker-timeout" }] });
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    expect(view(h).notice).toMatchObject({ kind: "skipped", cause: "blocked" });
    expect(h.checks).toEqual(["blocked"]);
  });

  it("a 403 on every source says so and counts as a network failure", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    h.youtube.fail(y("a"), "all-failed", { attempts: [{ code: "http", status: 403 }] });
    h.deck.emit("error", { error: { code: 2, httpStatus: 403 } });
    await flush();
    expect(view(h).notice).toMatchObject({ kind: "skipped", cause: "blocked" });
    expect(h.notices[0]).toContain("YouTube refuses");
  });
});

describe("a pinned version", () => {
  it("plays first, with no marker, after the stand-in was kept", async () => {
    const h = createHarness();
    withSoundcloud(h);
    h.youtube.fail(y("a"), "unavailable");
    h.engine.playList([track(y("a"))]);
    await flush();
    expect(view(h).stream?.source).toBe("soundcloud");
    let stored: string | null = null;
    h.daemon.on(`PUT /v1/tracks/${y("a")}/alternative`, async (request) => {
      stored = await request.text();
      return new Response(null, { status: 204 });
    });
    h.daemon.on(`GET /v1/tracks/${y("a")}/alternative`, () => new Response(stored, { status: 200 }));
    expect(await h.engine.keepVersion()).toBe(true);
    expect(view(h).fallback).toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({ altId: "sc:7", reason: "pinned" });
    h.youtube.script.delete(y("a"));
    h.youtube.resolves.length = 0;
    h.engine.next();
    h.engine.playList([track(y("a"))]);
    await flush();
    expect(view(h).stream?.source).toBe("soundcloud");
    expect(view(h).fallback).toBeNull();
    expect(h.youtube.resolves).toEqual([]);
  });

  it("nothing to keep when the track plays from its own source", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a"))]);
    await flush();
    expect(await h.engine.keepVersion()).toBe(false);
  });
});
