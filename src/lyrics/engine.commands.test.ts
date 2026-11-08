import { describe, expect, it, vi, afterEach } from "vitest";
import { OFFSET_SAVE_DELAY_MS } from "./engine";
import { setup } from "./test/setup";
import { LRC_TWO, PLAIN_TWO, done, found, meta, track } from "./test/events";
import { flush } from "./test/fakes";

afterEach(() => {
  vi.useRealTimers();
});

const starts = (s: ReturnType<typeof setup>) => s.state().lines.map((line) => line.fromMs);

describe("offsets", () => {
  it("24 shifts the shown lines and restores them at 0", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    s.engine.changeOffset(500);
    expect(starts(s)).toEqual([1500, 5000]);
    s.engine.changeOffset(-2000);
    expect(starts(s)).toEqual([0, 2500]);
    s.engine.changeOffset(0);
    expect(starts(s)).toEqual([1000, 4500]);
  });

  it("26 five quick nudges make one write with the sum", async () => {
    vi.useFakeTimers();
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    for (let index = 0; index < 5; index += 1) s.engine.nudgeOffset(100);
    expect(s.daemon.saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(OFFSET_SAVE_DELAY_MS);
    expect(s.daemon.saved).toEqual([["t", 500]]);
  });

  it("27 a large offset is clamped", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    s.engine.changeOffset(45_000);
    expect(s.state().offsetMs).toBe(30_000);
  });

  it("28 each track keeps its own offset; switching versions keeps it", async () => {
    const s = setup({
      a: [meta("a", 300), found("lrclib"), found("plainsrc", PLAIN_TWO, { format: "plain", quality: 0.5 }), done()],
      b: [meta("b", 0), found("lrclib"), done()],
    });
    await s.engine.follow(track("a"));
    expect(s.state().offsetMs).toBe(300);
    expect(starts(s)).toEqual([1300, 4800]);
    await s.engine.follow(track("b"));
    expect(s.state().offsetMs).toBe(0);
    await s.engine.follow(track("a"));
    expect(s.state().offsetMs).toBe(300);
    s.engine.chooseVersion("plainsrc");
    expect(s.state()).toMatchObject({ activeVersion: "plainsrc", offsetMs: 300 });
    s.engine.nudgeOffset(100);
    expect(s.state().offsetMs).toBe(400);
  });

  it("a late metadata offset does not overwrite an offset the user set while loading", async () => {
    const s = setup({ t: ["hold", meta("t", 300), found("lrclib"), done()] });
    const follow = s.engine.follow(track("t"));
    await flush();
    s.engine.changeOffset(500);
    s.daemon.release("t");
    await follow;
    expect(s.state()).toMatchObject({ status: "ready", offsetMs: 500 });
    expect(starts(s)).toEqual([1500, 5000]);
  });

  it("34 an offset change while paused recomputes the active line once, without a frame", async () => {
    const s = setup({ t: [found("lrclib", "[00:01.00]A\n[00:04.50]B\n[00:09.00]C"), done()] });
    s.audio.state.positionMs = 4000;
    await s.engine.follow(track("t"));
    expect(s.state().currentLine).toBe(1);
    s.engine.changeOffset(500);
    expect(s.state().currentLine).toBe(0);
    expect(s.frames.pending()).toBe(0);
  });

  it("RF3 a pending offset is written for the old track when the track changes", async () => {
    vi.useFakeTimers();
    const s = setup({ a: [found("lrclib"), done()], b: [found("lrclib"), done()] });
    await s.engine.follow(track("a"));
    s.engine.changeOffset(200);
    await s.engine.follow(track("b"));
    expect(s.daemon.saved).toEqual([["a", 200]]);
    await vi.advanceTimersByTimeAsync(OFFSET_SAVE_DELAY_MS);
    expect(s.daemon.saved).toEqual([["a", 200]]);
    expect(s.state().offsetMs).toBe(0);
  });

  it("RF4 a refused offset write keeps the offset for the session", async () => {
    vi.useFakeTimers();
    const s = setup({ t: [found("lrclib"), done()], u: [done()] });
    s.daemon.failSaves = true;
    await s.engine.follow(track("t"));
    s.engine.nudgeOffset(100);
    await vi.advanceTimersByTimeAsync(OFFSET_SAVE_DELAY_MS);
    await flush();
    expect(s.daemon.saved).toEqual([["t", 100]]);
    await s.engine.follow(track("u"));
    await s.engine.follow(track("t"));
    expect(s.state().offsetMs).toBe(100);
  });

  it("offset commands without a track do nothing", () => {
    const s = setup();
    s.engine.nudgeOffset(100);
    expect(s.state().offsetMs).toBe(0);
    expect(s.daemon.saved).toEqual([]);
  });
});

describe("versions", () => {
  it("41 a chosen version stays when a better one arrives in the same stream, and is remembered", async () => {
    const s = setup({
      t: [
        found("syncsrc", LRC_TWO, { quality: 0.8 }),
        found("plainsrc", PLAIN_TWO, { format: "plain", quality: 0.5 }),
        "hold",
        found("better", LRC_TWO, { quality: 0.95 }),
        done(),
      ],
    });
    const run = s.engine.follow(track("t"));
    await flush();
    expect(s.state().versions.map((v) => v.provider)).toEqual(["syncsrc", "plainsrc"]);
    s.engine.chooseVersion("plainsrc");
    expect(s.state()).toMatchObject({ activeVersion: "plainsrc", synced: false, lines: [], plainText: PLAIN_TWO });
    s.daemon.release("t");
    await run;
    expect(s.state().versions.map((v) => v.provider)).toEqual(["better", "syncsrc", "plainsrc"]);
    expect(s.state().activeVersion).toBe("plainsrc");
    await s.engine.follow(track("u"));
    await s.engine.follow(track("t"));
    expect(s.state().activeVersion).toBe("plainsrc");
  });

  it("choosing an unknown provider changes nothing", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    s.engine.chooseVersion("missing");
    expect(s.state().activeVersion).toBe("lrclib");
  });
});

describe("line loop", () => {
  it("runs while a view subscribes to the engine and stops when the last one leaves", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    s.audio.state.playing = true;
    await s.engine.follow(track("t"));
    expect(s.frames.pending()).toBe(0);
    const first = s.engine.subscribe(() => undefined);
    const second = s.engine.subscribe(() => undefined);
    expect(s.frames.pending()).toBe(1);
    s.audio.state.positionMs = 4600;
    s.frames.run();
    expect(s.state().currentLine).toBe(1);
    first();
    expect(s.frames.pending()).toBe(1);
    second();
    expect(s.frames.pending()).toBe(0);
  });
});

describe("reload", () => {
  it("streams the shown track again and shows what the daemon has now", async () => {
    const scripts: Record<string, ReturnType<typeof found | typeof done>[]> = { t: [found("lrclib"), done()] };
    const s = setup(scripts);
    await s.engine.follow(track("t"));
    scripts.t = [found("user", PLAIN_TWO, { format: "plain", quality: 1 }), done()];
    await s.engine.reload(track("t"));
    expect(s.daemon.requests).toEqual(["t", "t"]);
    expect(s.state()).toMatchObject({ trackId: "t", status: "ready", activeVersion: "user" });
  });

  it("forgets a track that is not shown, so its next follow streams again without changing the view", async () => {
    const s = setup({ a: [found("lrclib"), done()], b: [found("lrclib"), done()] });
    await s.engine.follow(track("a"));
    await s.engine.follow(track("b"));
    await s.engine.reload(track("a"));
    expect(s.state().trackId).toBe("b");
    expect(s.daemon.requests).toEqual(["a", "b"]);
    await s.engine.follow(track("a"));
    expect(s.daemon.requests).toEqual(["a", "b", "a"]);
  });
});
