import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lyrics", () => ({ lyrics: () => ({ reload: async () => undefined }) }));
vi.mock("./player", () => ({ usePlayerStore: { getState: () => ({ currentTrack: null }) } }));

import { cancelMaking, madeBy, makeLyrics, makerOffer, resetMadeForTests, type MadeSource, type MadeView } from "./lyricsMaker";
import type { WordTimingJob, WordTimingModel, WordTimingView } from "./wordTiming";

const job = (state: WordTimingJob["state"], progress = 0, extra: Partial<WordTimingJob> = {}): WordTimingJob => ({
  trackId: "t1",
  model: "whisper-base",
  state,
  progress,
  ...extra,
});
const timing = (extra: Partial<WordTimingView> = {}): WordTimingView => ({ enabled: false, models: [], ...extra });
const made = (models: WordTimingModel[] = [], source?: MadeSource, state?: WordTimingJob["state"], extra: Partial<WordTimingJob> = {}): MadeView =>
  source && state ? { models, job: { ...job(state, 0, extra), source } } : { models };

describe("lyrics Nuvo makes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMadeForTests();
  });

  it("offers to write, time plain text and time synced lines, each with its own model", () => {
    expect(makerOffer(timing(), made(), "t1", "none")).toEqual({ kind: "offer", task: "write", downloadMb: 264 });
    expect(makerOffer(timing(), made(), "t1", "plain")).toEqual({ kind: "offer", task: "time", downloadMb: 82 });
    expect(makerOffer(timing(), made(), "t1", "lines")).toEqual({ kind: "offer", task: "time", downloadMb: 82 });
    expect(makerOffer(timing(), made(["whisper-small"]), "t1", "none")).toMatchObject({ downloadMb: null });
    expect(makerOffer(timing(), made(), "t1", "words")).toEqual({ kind: "none" });
    expect(makerOffer(null, made(), "t1", "lines")).toEqual({ kind: "none" });
    expect(makerOffer(timing(), null, "t1", "none")).toEqual({ kind: "none" });
  });

  it("leaves synced lines to the switch once it is on, but still makes the rest on request", () => {
    expect(makerOffer(timing({ enabled: true }), made(), "t1", "lines")).toEqual({ kind: "none" });
    expect(makerOffer(timing({ enabled: true }), made(), "t1", "plain")).toMatchObject({ kind: "offer" });
  });

  it("follows this song's job through download, preparation and running, and ignores another song's or another kind", () => {
    expect(makerOffer(timing(), made([], "transcribed", "waiting", { model: "whisper-small" }), "t1", "none")).toMatchObject({
      kind: "working",
      task: "write",
      phase: "download",
    });
    expect(makerOffer(timing(), made(["whisper-base"], "aligned", "waiting"), "t1", "plain")).toMatchObject({ phase: "prepare" });
    expect(makerOffer(timing(), { models: [], job: { ...job("running", 0.426), source: "transcribed" } }, "t1", "none")).toMatchObject({
      phase: "running",
      percent: 43,
    });
    expect(makerOffer(timing(), made([], "aligned", "running"), "t1", "none")).toMatchObject({ kind: "offer" });
    expect(makerOffer(timing({ enabled: true, job: job("running", 0.5, { trackId: "t2" }) }), made(), "t1", "lines")).toEqual({ kind: "none" });
    expect(
      makerOffer(timing({ enabled: true, models: ["whisper-base"], job: job("waiting", 0, { model: "whisper-small" }) }), made(), "t1", "words"),
    ).toMatchObject({
      kind: "working",
      phase: "download",
      model: "whisper-small",
    });
  });

  it("says a made job failed, and a word timing job only while the switch is on", () => {
    expect(makerOffer(timing(), made([], "transcribed", "failed", { code: "no_vocals" }), "t1", "none")).toEqual({
      kind: "failed",
      task: "write",
      code: "no_vocals",
    });
    const failed = job("failed", 0.3, { code: "lyrics_mismatch" });
    expect(makerOffer(timing({ enabled: true, job: failed }), made(), "t1", "lines")).toEqual({ kind: "failed", task: "time", code: "lyrics_mismatch" });
    expect(makerOffer(timing({ job: failed }), made(), "t1", "lines")).toMatchObject({ kind: "offer" });
  });

  it("asks the daemon for made lyrics without the switch and cancels the right job", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url.replace(/^.*?\/v1/, "/v1")} ${init.body ?? ""}`.trim());
        return new Response(JSON.stringify({ models: [] }));
      }),
    );
    await makeLyrics(timing(), "t 1", "none");
    await makeLyrics(timing(), "t1", "plain");
    await cancelMaking("t1", "plain");
    expect(calls).toEqual([
      'POST /v1/tracks/t%201/lyrics/made {"source":"transcribed"}',
      "GET /v1/lyrics/made",
      'POST /v1/tracks/t1/lyrics/made {"source":"aligned"}',
      "GET /v1/lyrics/made",
      "DELETE /v1/tracks/t1/lyrics/made/job",
      "GET /v1/lyrics/made",
    ]);
  });

  it("credits written and timed versions and nothing else", () => {
    expect(madeBy("transcribed")).toBe("written");
    expect(madeBy("aligned")).toBe("timed");
    expect(madeBy("synced")).toBe("timed");
    expect(madeBy(undefined)).toBeNull();
  });
});
