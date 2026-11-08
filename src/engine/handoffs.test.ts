import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { validateSurfaceState } from "../../electron/app/validate";
import { runCommand } from "./commands";
import { PlayTracker } from "./playReport";
import { SurfaceSender, toSurfaceState } from "./surface";
import { fallbackHover, stateLine, streamHover } from "./stateLine";
import { advance, createHarness, flush, track, y, type Harness } from "./test/harness";
import type { PlayerView, QueueEntry, SurfaceState } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(5_000_000);
});
afterEach(() => vi.useRealTimers());

const list = (...letters: string[]) => letters.map((l) => track(y(l)));
const entry = (id: string, extra = {}): QueueEntry => ({ entryId: `e-${id}`, track: track(id, extra), origin: "list", order: 0 });

async function start(h: Harness, tracks = list("a", "b", "c"), context?: string) {
  h.engine.playList(tracks, { context });
  await flush();
}

/** Advances wall time in 250 ms position updates while playing. */
async function play(h: Harness, ms: number) {
  for (let t = 0; t < ms; t += 250) {
    await vi.advanceTimersByTimeAsync(250);
    h.deck.emit("timeupdate", { positionMs: h.deck.position + 250 });
  }
}

describe("play reports", () => {
  it("a 20 s play then next is a skip", async () => {
    const h = createHarness();
    await start(h);
    await play(h, 20_000);
    h.engine.next();
    const r = h.reports[0];
    expect(r.endReason).toBe("skip");
    expect(r.skipped).toBe(true);
    expect(Math.abs(r.playedDurationMs - 20_000)).toBeLessThanOrEqual(300);
  });

  it("a 45 s play then next is next", async () => {
    const h = createHarness();
    await start(h);
    await play(h, 45_000);
    h.engine.next();
    expect(h.reports[0]).toMatchObject({ endReason: "next", skipped: false });
  });

  it("a natural end is complete", async () => {
    const h = createHarness();
    await start(h);
    await play(h, 2000);
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    expect(h.reports[0]).toMatchObject({ endReason: "complete", completed: true });
    expect(h.reports[0].completionRate).toBeLessThanOrEqual(1);
  });

  it("a 1 s skip is reported; a 1 s stop is not", async () => {
    const h = createHarness();
    await start(h);
    await play(h, 1000);
    h.engine.next();
    expect(h.reports.at(-1)?.endReason).toBe("skip");
    const f = createHarness();
    await start(f);
    await play(f, 1000);
    await f.engine.forgetSession();
    expect(f.reports).toHaveLength(0);
  });

  it("a failed start reports error with source and reason", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "unplayable");
    await start(h);
    await advance(100);
    expect(h.reports[0]).toMatchObject({ endReason: "error", source: "youtube", fallbackReason: "unavailable" });
  });

  it("three repeat-one loops are one report with loopCount 3", async () => {
    const h = createHarness();
    await start(h);
    h.engine.setRepeat("one");
    h.deck.duration = 200_000;
    for (let i = 0; i < 3; i++) {
      h.deck.emit("ended", { positionMs: 200_000 });
      await flush();
    }
    h.engine.next();
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({ loopCount: 3, completed: true });
  });

  it("start time, context and timezone offset", async () => {
    const h = createHarness();
    await start(h, list("a", "b"), "playlist:p1");
    await play(h, 5000);
    h.engine.next();
    expect(h.reports[0]).toMatchObject({ startedAt: 5_000_000, context: { type: "playlist", id: "p1" }, tzOffsetMin: new Date(5_000_000).getTimezoneOffset() });
  });

  it("positions in session and a new session after 31 minutes", () => {
    let now = 0;
    const tracker = new PlayTracker(
      () => now,
      (() => {
        let n = 0;
        return () => `s${++n}`;
      })(),
    );
    const bodies = [];
    for (let i = 0; i < 3; i++) {
      tracker.begin(entry(`t${i}`), null);
      now += 1000;
      bodies.push(tracker.end("change")!);
    }
    expect(bodies.map((b) => b.positionInSession)).toEqual([1, 2, 3]);
    now += 31 * 60_000;
    tracker.begin(entry("t4"), null);
    const fourth = tracker.end("change")!;
    expect(fourth.positionInSession).toBe(1);
    expect(fourth.listeningSessionId).not.toBe(bodies[0].listeningSessionId);
  });

  it("a 60 s clock jump is not played time", () => {
    let now = 0;
    const tracker = new PlayTracker(
      () => now,
      () => "s",
    );
    tracker.begin(entry("t"), null);
    tracker.observe(true);
    for (let i = 0; i < 4; i++) {
      now += 250;
      tracker.observe(true);
    }
    now += 60_000;
    tracker.observe(true);
    for (let i = 0; i < 4; i++) {
      now += 250;
      tracker.observe(true);
    }
    expect(tracker.end("change")!.playedDurationMs).toBe(2000);
  });

  it("seek flags", () => {
    const tracker = new PlayTracker(
      () => 0,
      () => "s",
    );
    tracker.begin(entry("t"), null);
    tracker.seek(50_000, 40_000);
    tracker.seek(40_000, 100_000);
    tracker.seek(100_000, 102_000);
    const body = tracker.end("change")!;
    expect(body.hasSeekBackward).toBe(true);
    expect(body.seekForwardMs).toBe(60_000);
  });

  it("snapshot artists from the list, the display string, or unknown", () => {
    const run = (extra: object) => {
      const tracker = new PlayTracker(
        () => 0,
        () => "s",
      );
      tracker.begin(entry("t", extra), null);
      return tracker.end("change")!.trackSnapshot.artists;
    };
    expect(
      run({
        artistList: [
          { id: "a1", name: "A" },
          { id: "b1", name: "B" },
        ],
      }),
    ).toEqual([
      { id: "a1", name: "A" },
      { id: "b1", name: "B" },
    ]);
    expect(run({ artists: "A, B", artistId: "x" })).toEqual([
      { id: "x", name: "A" },
      { id: "x", name: "B" },
    ]);
    expect(run({ artists: "" })).toEqual([{ id: "unknown", name: "Unknown Artist" }]);
  });

  it("a rejected report is not retried", async () => {
    const h = createHarness();
    let calls = 0;
    h.deps.postReport = async () => {
      calls += 1;
      if (calls === 1) throw new Error("400");
    };
    await start(h);
    await play(h, 5000);
    h.engine.next();
    await flush();
    await play(h, 5000);
    h.engine.next();
    await flush();
    expect(calls).toBe(2);
  });

  it("forget session waits for a slow report", async () => {
    let release!: () => void;
    const h = createHarness({ slowReport: new Promise<void>((r) => (release = r)) });
    await start(h);
    await play(h, 5000);
    let done = false;
    const run = h.engine.forgetSession().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    release();
    await run;
    expect(done).toBe(true);
  });
});

function view(partial: Partial<PlayerView>): PlayerView {
  return {
    status: "playing",
    pauseReason: null,
    entries: [],
    index: -1,
    current: null,
    positionMs: 0,
    durationMs: 0,
    context: null,
    listCover: null,
    continuing: false,
    repeat: "off",
    shuffle: false,
    volume: 1,
    tempo: { rate: 1, semitones: 0, linked: true, keepAcrossTracks: true },
    reverb: { on: false, level: 0.35 },
    output: { chosen: null, active: { id: "", label: "System default" }, fellBack: false },
    bestQuality: false,
    stream: null,
    fallback: null,
    notice: null,
    ...partial,
  };
}

describe("surface snapshot", () => {
  it("public page and cover; private covers are dropped", () => {
    const yt = entry(y("a"), { coverUrl: "https://i.ytimg.com/vi/x/hq.jpg" });
    const state = toSurfaceState(view({ entries: [yt], index: 0, current: yt }), { liked: false, now: 1 });
    expect(state.sourcePageUrl).toBe(`https://music.youtube.com/watch?v=${y("a")}`);
    expect(state.publicCoverUrl).toBe("https://i.ytimg.com/vi/x/hq.jpg");
    for (const cover of ["nuvo-core://local/covers/1", "data:image/png;base64,AA", "blob:x"]) {
      const e = entry(y("a"), { coverUrl: cover });
      expect(toSurfaceState(view({ entries: [e], index: 0, current: e }), { liked: false, now: 1 }).publicCoverUrl).toBeUndefined();
    }
  });

  it("YouTube Music artwork on yt3.googleusercontent.com reaches the Notch through main's validator, up next too", () => {
    const cover = `https://yt3.googleusercontent.com/${"N55arCGj69gtw6thXK8JUPisxoVYiwuIEQ7I6SGlkEyNcSJ7x".repeat(6)}=w512-h512-l90-rj`;
    const [first, second] = ["a", "b"].map((l) => entry(y(l), { coverUrl: cover }));
    const state = validateSurfaceState(toSurfaceState(view({ entries: [first, second], index: 0, current: first }), { liked: false, now: 1 }));
    expect(state?.publicCoverUrl).toBe(cover);
    expect(state?.upNext[0].coverUrl).toBe(cover);
  });

  it("overlong SoundCloud page and cover URLs are dropped so main's validator keeps the state", () => {
    const longPath = "a".repeat(600);
    const sc = entry("sc:1", { permalinkUrl: `https://soundcloud.com/${longPath}`, coverUrl: `https://i1.sndcdn.com/${"b".repeat(2100)}.jpg` });
    const state = toSurfaceState(view({ entries: [sc], index: 0, current: sc }), { liked: false, now: 1 });
    expect(state.sourcePageUrl).toBeUndefined();
    expect(state.publicCoverUrl).toBeUndefined();
    expect(validateSurfaceState(state)).not.toBeNull();
    const ok = entry("sc:2", { permalinkUrl: "https://soundcloud.com/artist/song", coverUrl: "https://i1.sndcdn.com/art.jpg" });
    expect(validateSurfaceState(toSurfaceState(view({ entries: [ok], index: 0, current: ok }), { liked: false, now: 1 }))).toMatchObject({
      sourcePageUrl: "https://soundcloud.com/artist/song",
      publicCoverUrl: "https://i1.sndcdn.com/art.jpg",
    });
  });

  it("up next carries the next three entries, private covers filtered to empty", () => {
    const entries = ["a", "b", "c", "d", "e", "f"].map((l) => entry(y(l)));
    const state = toSurfaceState(view({ entries, index: 0, current: entries[0] }), { liked: false, now: 1 });
    expect(state.upNext.map((u) => u.id)).toEqual([y("b"), y("c"), y("d")]);
    expect(state.upNext[0]).toEqual({ id: y("b"), title: `Title ${y("b")}`, artist: `Artist ${y("b")}`, coverUrl: "", durationMs: 200_000 });
    const withPrivate = [
      entry(y("x"), { coverUrl: "nuvo-core://local/covers/1" }),
      entry(y("y"), { coverUrl: "data:image/png;base64,AA" }),
      entry(y("z"), { coverUrl: "blob:x" }),
    ];
    const statePrivate = toSurfaceState(view({ entries: withPrivate, index: 0, current: withPrivate[0] }), { liked: false, now: 1 });
    expect(statePrivate.upNext.every((u) => u.coverUrl === "")).toBe(true);
  });

  it("twenty changes in a second send at most four, the last one final", async () => {
    const sent: SurfaceState[] = [];
    let status: PlayerView["status"] = "paused";
    const e = entry(y("a"));
    const sender = new SurfaceSender(
      () => toSurfaceState(view({ entries: [e], index: 0, current: e, status }), { liked: false, now: Date.now() }),
      (s) => sent.push(s),
      () => Date.now(),
    );
    for (let i = 0; i < 20; i++) {
      status = i % 2 ? "paused" : "loading";
      sender.poke();
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(300);
    const inWindow = sent.filter((s) => s.sampledAt < 5_001_000);
    expect(inWindow.length).toBeLessThanOrEqual(4);
    expect(sent.at(-1)?.status).toBe(status);
    sender.dispose();
  });

  it("heartbeat every 2 s, a seek at once, drift not early", async () => {
    const sent: SurfaceState[] = [];
    let offset = 0;
    const e = entry(y("a"));
    const position = () => Date.now() - 5_000_000 + offset;
    const sender = new SurfaceSender(
      () => toSurfaceState(view({ entries: [e], index: 0, current: e, positionMs: position() }), { liked: false, now: Date.now() }),
      (s) => sent.push(s),
      () => Date.now(),
    );
    sender.poke();
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    offset += 2000;
    sender.poke();
    expect(sent).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(500);
    offset += 300;
    sender.poke();
    expect(sent).toHaveLength(3);
    sender.dispose();
  });
});

describe("commands from main", () => {
  it("malformed commands are ignored; a valid seek seeks", async () => {
    const h = createHarness();
    await start(h);
    const library = { like: vi.fn(), unlike: vi.fn() };
    runCommand(h.engine, library, { type: "seek", positionMs: "x" });
    runCommand(h.engine, library, { type: "dance" });
    expect(h.deck.seeks).toEqual([]);
    runCommand(h.engine, library, { type: "seek", positionMs: 30_000 });
    expect(h.deck.seeks).toEqual([30_000]);
  });

  it("playEntry picks the first upcoming match", async () => {
    const h = createHarness();
    const b = track(y("b"));
    await start(h, [track(y("a")), b, track(y("c")), b]);
    const library = { like: vi.fn(), unlike: vi.fn() };
    runCommand(h.engine, library, { type: "playEntry", trackId: y("z") });
    expect(h.engine.getView().index).toBe(0);
    runCommand(h.engine, library, { type: "playEntry", trackId: y("b") });
    expect(h.engine.getView().index).toBe(1);
  });

  it("volume deltas clamp and round", async () => {
    const h = createHarness();
    const library = { like: vi.fn(), unlike: vi.fn() };
    h.engine.changeVolume(0.98);
    runCommand(h.engine, library, { type: "volumeDelta", delta: 0.05 });
    expect(h.engine.getView().volume).toBe(1);
    h.engine.changeVolume(0.333);
    runCommand(h.engine, library, { type: "volumeDelta", delta: -0.1 });
    expect(h.engine.getView().volume).toBe(0.23);
  });

  it("neighbour prefetch touches only the next entry, once per pair", async () => {
    const h = createHarness();
    const tracks = ["a", "b", "c", "d"].map((l) => track(y(l), { coverUrl: `https://i.ytimg.com/${l}.jpg` }));
    await start(h, tracks);
    expect(h.warmed).toEqual(["https://i.ytimg.com/b.jpg"]);
    expect(h.lyrics.filter((l) => l.kind === "prefetch").map((l) => l.id)).toEqual([y("b")]);
    expect(h.deck.candidates.filter(Boolean).map((c) => c!.trackId)).toEqual([y("b")]);
    h.engine.setShuffle(false);
    h.engine.changeVolume(0.5);
    expect(h.warmed).toHaveLength(1);
    h.engine.insertNext(tracks[2]);
    expect(h.lyrics.filter((l) => l.kind === "prefetch").map((l) => l.id)).toEqual([y("b"), y("c")]);
  });

  it("dislike reaches the library with the playing track, and nothing without one", async () => {
    const idle = createHarness();
    const none = { like: vi.fn(), unlike: vi.fn(), dislike: vi.fn() };
    runCommand(idle.engine, none, { type: "dislike" });
    expect(none.dislike).not.toHaveBeenCalled();
    const h = createHarness();
    await start(h);
    const library = { like: vi.fn(), unlike: vi.fn(), dislike: vi.fn() };
    runCommand(h.engine, library, { type: "dislike" });
    expect(library.dislike).toHaveBeenCalledWith(h.engine.getView().current!.track);
  });

  it("seek with no current track is ignored", async () => {
    const h = createHarness();
    const library = { like: vi.fn(), unlike: vi.fn() };
    runCommand(h.engine, library, { type: "seek", positionMs: 30_000 });
    expect(h.deck.seeks).toEqual([]);
  });

  it("seek with NaN, Infinity, negative, or over-duration values is ignored", async () => {
    const h = createHarness();
    const library = { like: vi.fn(), unlike: vi.fn() };
    await start(h);
    runCommand(h.engine, library, { type: "seek", positionMs: NaN });
    runCommand(h.engine, library, { type: "seek", positionMs: Infinity });
    runCommand(h.engine, library, { type: "seek", positionMs: -1 });
    runCommand(h.engine, library, { type: "seek", positionMs: 201_000 });
    expect(h.deck.seeks).toEqual([]);
  });

  it("volumeDelta with NaN, Infinity, or >1 magnitude is ignored", async () => {
    const h = createHarness();
    const library = { like: vi.fn(), unlike: vi.fn() };
    h.engine.changeVolume(0.5);
    runCommand(h.engine, library, { type: "volumeDelta", delta: NaN });
    runCommand(h.engine, library, { type: "volumeDelta", delta: Infinity });
    runCommand(h.engine, library, { type: "volumeDelta", delta: 1.5 });
    expect(h.engine.getView().volume).toBe(0.5);
  });

  it("transport commands toggle, play, pause, next, previous work", async () => {
    const h = createHarness();
    const library = { like: vi.fn(), unlike: vi.fn() };
    await start(h);
    runCommand(h.engine, library, { type: "pause" });
    expect(h.engine.getView().status).toBe("paused");
    runCommand(h.engine, library, { type: "toggle" });
    await flush();
    expect(h.engine.getView().status).toBe("playing");
    runCommand(h.engine, library, { type: "play" });
    expect(h.engine.getView().status).toBe("playing");
  });

  it("like and unlike are ignored with no current track", async () => {
    const h = createHarness();
    const like = vi.fn();
    const unlike = vi.fn();
    const library = { like, unlike };
    runCommand(h.engine, library, { type: "like" });
    runCommand(h.engine, library, { type: "unlike" });
    expect(like).not.toHaveBeenCalled();
    expect(unlike).not.toHaveBeenCalled();
  });
});

describe("state line", () => {
  it("stateLine priority: device lost > fallback > station > sleep > quality", () => {
    const base = view({ status: "paused" as const });
    expect(stateLine(base, {})).toBeNull();

    expect(stateLine({ ...base, pauseReason: "device_lost" }, {})).toEqual({ key: "deviceLost", params: {} });

    const fallback = { primarySource: "youtube" as const, usedSource: "cache" as const, cause: "unavailable" as const, score: 0.95, restarted: false };
    expect(stateLine({ ...base, status: "playing", pauseReason: null, fallback }, {})).toEqual({
      key: "playedFrom",
      params: { source: "cache" },
    });

    expect(stateLine({ ...base, status: "playing", pauseReason: null, context: "radio:r1" }, { stationTitle: "Jazz" })).toEqual({
      key: "station",
      params: { title: "Jazz" },
    });

    expect(
      stateLine(
        view({ status: "playing", pauseReason: null, bestQuality: true, stream: { source: "youtube", codec: "opus", bitrateKbps: 160, fromCache: false } }),
        { sleepRemainingMs: 300_000 },
      ),
    ).toEqual({
      key: "sleep",
      params: { remainingMs: 300_000 },
    });

    expect(
      stateLine(
        view({ status: "playing", pauseReason: null, bestQuality: true, stream: { source: "youtube", codec: "opus", bitrateKbps: 160, fromCache: false } }),
        {},
      ),
    ).toEqual({
      key: "bestQuality",
      params: { codec: "Opus", kbps: 160 },
    });
  });

  it("streamHover formats codec, bitrate, and source", () => {
    expect(streamHover({ source: "youtube", codec: "opus", bitrateKbps: 160, fromCache: false })).toBe("Opus · 160 kbps · YouTube");
    expect(streamHover({ source: "soundcloud", codec: "aac", bitrateKbps: 128, fromCache: false })).toBe("AAC · 128 kbps · SoundCloud");
    expect(streamHover({ source: "youtube", codec: "mp3", bitrateKbps: 192, fromCache: true })).toBe("MP3 · 192 kbps · from cache");
  });

  it("fallbackHover formats primary source, cause, and score", () => {
    const fallback = { primarySource: "youtube" as const, usedSource: "cache" as const, cause: "unavailable" as const, score: 0.95, restarted: false };
    const text = fallbackHover(fallback);
    expect(text).toContain("YouTube: unavailable in your region");
    expect(text).toContain("score 0.95");
    expect(text).not.toContain("Restarted");

    const restarted = { ...fallback, restarted: true };
    expect(fallbackHover(restarted)).toContain("Restarted: different length");
  });
});
