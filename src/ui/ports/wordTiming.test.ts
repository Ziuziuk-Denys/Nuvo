import { afterEach, describe, expect, it, vi } from "vitest";

const reload = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lyrics", () => ({ lyrics: () => ({ reload }) }));
vi.mock("./player", () => ({ usePlayerStore: { getState: () => ({ currentTrack: { id: "t1" } }) } }));

import { POLL_MS, isLocalTiming, isRunning, refresh, resetForTests, setWordTiming, timeWords, type WordTimingJob } from "./wordTiming";

function answer(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const job = (state: WordTimingJob["state"], progress: number): WordTimingJob => ({ trackId: "t1", model: "whisper-base", state, progress });

afterEach(() => {
  resetForTests();
  reload.mockClear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("word timing port", () => {
  it("knows the versions timed on this computer and which jobs still run", () => {
    expect(isLocalTiming("whisper-base") && isLocalTiming("whisper-small")).toBe(true);
    expect(isLocalTiming("lrclib") || isLocalTiming(null)).toBe(false);
    expect(isRunning(job("running", 0.5), "t1")).toBe(true);
    expect(isRunning(job("running", 0.5), "t2")).toBe(false);
    expect(isRunning(job("done", 1), "t1")).toBe(false);
  });

  it("follows a running job and shows the new lyrics once it is done", async () => {
    vi.useFakeTimers();
    const replies = [answer({ enabled: true, models: [], job: job("running", 0.2) }), answer({ enabled: true, models: ["whisper-base"], job: job("done", 1) })];
    const fetchMock = vi.fn(async () => replies.shift() ?? answer({ enabled: true, models: ["whisper-base"], job: job("done", 1) }));
    vi.stubGlobal("fetch", fetchMock);
    await refresh();
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks the daemon for the larger model and reloads the lyrics when the switch moves", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer({ enabled: true, models: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await timeWords("a/b", true);
    expect(fetchMock.mock.calls[0][0]).toBe("nuvo-core://local/v1/tracks/a%2Fb/lyrics/word-timing");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ best: true }));
    await setWordTiming(false);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("PUT");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
