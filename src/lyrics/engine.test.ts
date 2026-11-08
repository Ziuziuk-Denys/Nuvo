import { describe, expect, it, vi, afterEach } from "vitest";
import { LyricsEngine, PREFETCH_GIVE_UP_MS } from "./engine";
import { ENHANCED, LRC_TWO, PLAIN_TWO, done, found, meta, notFound, track } from "./test/events";
import { flush } from "./test/fakes";
import { setup } from "./test/setup";

afterEach(() => {
  vi.useRealTimers();
});

describe("follow and streaming", () => {
  it("1 a miss shows loading with empty lines and opens one stream", async () => {
    const s = setup({ t: ["hold"] });
    void s.engine.follow(track("t"));
    await flush();
    expect(s.state()).toMatchObject({ trackId: "t", status: "loading", lines: [] });
    expect(s.daemon.requests).toEqual(["t"]);
  });

  it("2 a found LRC version is parsed and shown", async () => {
    const s = setup({ t: [meta("t"), found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    expect(s.state()).toMatchObject({ status: "ready", synced: true, activeVersion: "lrclib", rawForView: { format: "lrc", content: LRC_TWO } });
    expect(s.state().lines.map((line) => line.text)).toEqual(["Morning light", "Over the hill"]);
  });

  it("3 a better synced version replaces an earlier plain one", async () => {
    const s = setup({ t: [found("plainsrc", PLAIN_TWO, { format: "plain", quality: 0.5 }), found("syncsrc", LRC_TWO, { quality: 0.8 }), done()] });
    await s.engine.follow(track("t"));
    expect(s.state().versions.map((v) => v.provider)).toEqual(["syncsrc", "plainsrc"]);
    expect(s.state().activeVersion).toBe("syncsrc");
  });

  it("4 a word-timed version takes over from synced lyrics when it arrives", async () => {
    const s = setup({ t: [found("lrclib", LRC_TWO, { quality: 0.8 }), found("auto", ENHANCED, { quality: 0.55, syncLevel: "word_level" }), done()] });
    await s.engine.follow(track("t"));
    expect(s.state().versions.map((v) => v.provider)).toEqual(["auto", "lrclib"]);
    expect(s.state()).toMatchObject({ activeVersion: "auto", wordTimed: true });
  });

  it("5 user lyrics rank first", async () => {
    const s = setup({
      t: [found("lrclib", LRC_TWO, { quality: 0.9 }), found("user", PLAIN_TWO, { format: "plain", quality: 0.3, topPriority: true }), done()],
    });
    await s.engine.follow(track("t"));
    expect(s.state().activeVersion).toBe("user");
  });

  it("6 nothing found ends as none", async () => {
    const s = setup({ t: [meta("t"), notFound("lrclib"), done("not_found")] });
    await s.engine.follow(track("t"));
    expect(s.state().status).toBe("none");
  });

  it("7 an instrumental outcome ends as instrumental", async () => {
    const s = setup({ t: [notFound("lrclib"), done("instrumental")] });
    await s.engine.follow(track("t"));
    expect(s.state().status).toBe("instrumental");
  });

  it("8 a failure before anything is found is an error; after a found it is ignored", async () => {
    const s = setup({ t: ["fail"], u: [found("lrclib"), "fail"] });
    await s.engine.follow(track("t"));
    expect(s.state().status).toBe("error");
    await s.engine.follow(track("u"));
    expect(s.state()).toMatchObject({ trackId: "u", status: "ready" });
  });

  it("an error retries on the next follow of the same track", async () => {
    const s = setup({ t: ["fail"] });
    await s.engine.follow(track("t"));
    await s.engine.follow(track("t"));
    expect(s.daemon.requests).toEqual(["t", "t"]);
  });

  it("9 late events of an old track change nothing", async () => {
    const s = setup({ a: ["hold", found("lrclib"), done()], b: [done("not_found")] });
    const first = s.engine.follow(track("a"));
    await flush();
    await s.engine.follow(track("b"));
    s.daemon.release("a");
    await first;
    expect(s.state()).toMatchObject({ trackId: "b", status: "none", versions: [] });
  });

  it("10 following the same track twice opens one stream", async () => {
    const s = setup({ t: ["hold", found("lrclib"), done()] });
    void s.engine.follow(track("t"));
    await flush();
    await s.engine.follow(track("t"));
    expect(s.daemon.requests).toEqual(["t"]);
  });

  it("11 a track loaded this session shows at once without a request", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    await s.engine.follow(track("u"));
    const shown = s.engine.follow(track("t"));
    expect(s.state()).toMatchObject({ trackId: "t", status: "ready", activeVersion: "lrclib" });
    await shown;
    expect(s.daemon.requests).toEqual(["t", "u"]);
  });

  it("12 a running prefetch is joined, not repeated", async () => {
    const s = setup({ t: ["hold", found("lrclib"), done()] });
    const prefetch = s.engine.prefetch(track("t"));
    const follow = s.engine.follow(track("t"));
    await flush();
    expect(s.state().status).toBe("loading");
    s.daemon.release("t");
    await prefetch;
    await follow;
    expect(s.daemon.requests).toEqual(["t"]);
    expect(s.state()).toMatchObject({ trackId: "t", status: "ready" });
  });

  it("13 a prefetch gives up after 8 s and stores nothing", async () => {
    vi.useFakeTimers();
    const s = setup({ t: ["hold"] });
    const prefetch = s.engine.prefetch(track("t"));
    await vi.advanceTimersByTimeAsync(PREFETCH_GIVE_UP_MS);
    await prefetch;
    void s.engine.follow(track("t"));
    await flush();
    expect(s.daemon.requests).toEqual(["t", "t"]);
  });

  it("a prefetch that gave up is not repeated, while a follow still streams", async () => {
    vi.useFakeTimers();
    const s = setup({ t: ["hold"] });
    const first = s.engine.prefetch(track("t"));
    await vi.advanceTimersByTimeAsync(PREFETCH_GIVE_UP_MS);
    await first;
    await s.engine.prefetch(track("t"));
    expect(s.daemon.requests).toEqual(["t"]);
    void s.engine.follow(track("t"));
    await flush();
    expect(s.daemon.requests).toEqual(["t", "t"]);
  });

  it("a prefetch does not change what views see", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.prefetch(track("t"));
    expect(s.state().status).toBe("idle");
    await s.engine.follow(track("t"));
    expect(s.daemon.requests).toEqual(["t"]);
    expect(s.state().status).toBe("ready");
  });

  it("RF prefetch of the track being streamed opens no second stream", async () => {
    const s = setup({ t: ["hold", found("lrclib"), done()] });
    const follow = s.engine.follow(track("t"));
    await flush();
    await s.engine.prefetch(track("t"));
    s.daemon.release("t");
    await follow;
    expect(s.daemon.requests).toEqual(["t"]);
  });

  it("14 follow(null) empties everything", async () => {
    const s = setup({ t: [found("lrclib"), done()] });
    await s.engine.follow(track("t"));
    await s.engine.follow(null);
    expect(s.state()).toEqual({
      trackId: null,
      status: "idle",
      lines: [],
      plainText: null,
      synced: false,
      wordTimed: false,
      versions: [],
      activeVersion: null,
      offsetMs: 0,
      currentLine: null,
      rawForView: null,
    });
  });

  it("15 the memory cache keeps 20 tracks", async () => {
    const s = setup();
    for (let index = 0; index <= 20; index += 1) await s.engine.follow(track(`t${index}`));
    await s.engine.follow(track("t0"));
    expect(s.daemon.requests).toHaveLength(22);
    await s.engine.follow(track("t20"));
    expect(s.daemon.requests).toHaveLength(22);
  });

  it("a second found from one provider replaces the first", async () => {
    const s = setup({ t: [found("lrclib", PLAIN_TWO, { format: "plain", quality: 0.5 }), found("lrclib", LRC_TWO, { quality: 0.8 }), done()] });
    await s.engine.follow(track("t"));
    expect(s.state().versions).toHaveLength(1);
    expect(s.state().synced).toBe(true);
  });

  it("RF2 a stream that ends without done keeps what it showed and is not cached", async () => {
    const s = setup({ t: [found("lrclib")] });
    await s.engine.follow(track("t"));
    expect(s.state().status).toBe("ready");
    await s.engine.follow(track("u"));
    await s.engine.follow(track("t"));
    expect(s.daemon.requests).toEqual(["t", "u", "t"]);
  });

  it("follow never rejects, even when the stream cannot start", async () => {
    const engine = new LyricsEngine({
      stream: () => {
        throw new Error("no daemon");
      },
      saveOffset: async () => undefined,
      requestFrame: () => 0,
      cancelFrame: () => undefined,
      now: () => 0,
    });
    await expect(engine.follow(track("t"))).resolves.toBeUndefined();
    expect(engine.getState().status).toBe("error");
    await expect(engine.prefetch(track("u"))).resolves.toBeUndefined();
  });
});
