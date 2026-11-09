import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { LRC_TWO, track } from "./lyrics/test/events";

const player = {
  position: 0,
  status: "paused",
  rate: 1,
  listeners: new Set<() => void>(),
};
vi.mock("./engine", () => ({
  player: () => ({
    livePositionMs: () => player.position,
    audioTime: () => null,
    getView: () => ({ status: player.status, tempo: { rate: player.rate } }),
    subscribe: (listener: () => void) => {
      player.listeners.add(listener);
      return () => player.listeners.delete(listener);
    },
  }),
}));

import { lyrics } from "./lyrics";
import { bootLyrics, linkLyricsToPlayer } from "./lyricsBoot";

const sse = (events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
const song = sse([
  { type: "metadata", track: { id: "s1" }, offsetMs: 0 },
  {
    type: "provider",
    provider: "p",
    status: "found",
    syncLevel: "line_level",
    candidate: { provider: "p", syncLevel: "line_level", quality: { total: 0.8 }, lyrics: { format: "lrc", content: LRC_TWO } },
  },
  { type: "done", cached: false },
]);

describe("the lyrics loop", () => {
  it("runs on a timer at 30 updates a second, so frames with nothing to do cost no main frame", () => {
    vi.useFakeTimers();
    const animation = vi.fn();
    vi.stubGlobal("requestAnimationFrame", animation);
    const engine = bootLyrics();
    const done = vi.fn();
    const deps = (engine as unknown as { deps: { requestFrame(callback: () => void): number } }).deps;
    deps.requestFrame(done);
    vi.advanceTimersByTime(32);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(done).toHaveBeenCalledOnce();
    expect(animation).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("lyrics boot", () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  beforeEach(() => {
    calls.length = 0;
    player.position = 0;
    player.status = "paused";
    player.rate = 1;
    player.listeners.clear();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(url.includes("/lyrics?") ? song : "{}", { status: 200 });
    });
    localStorage.clear();
  });
  afterEach(() => {
    lyrics().dispose();
    vi.unstubAllGlobals();
  });

  it("the active line follows the player's position once the engine is linked and a view subscribes", async () => {
    const engine = bootLyrics();
    expect(lyrics()).toBe(engine);
    linkLyricsToPlayer();
    await engine.follow(track("s1"));
    expect(calls[0].url).toContain("nuvo-core://local/v1/tracks/s1/lyrics?");
    expect(engine.getState().status).toBe("ready");

    vi.useFakeTimers();
    const release = engine.subscribe(() => undefined);
    player.status = "playing";
    player.position = 2000;
    for (const listener of player.listeners) listener();
    vi.advanceTimersByTime(40);
    expect(engine.getState().currentLine).toBe(0);

    player.position = 5000;
    vi.advanceTimersByTime(40);
    expect(engine.getState().currentLine).toBe(1);
    release();
    vi.useRealTimers();
  });

  it("a paused, restored position reaches the views' clock with no play or seek", async () => {
    const engine = bootLyrics();
    linkLyricsToPlayer();
    player.position = 5000;
    await engine.follow(track("s1"));
    expect(engine.clock()).toEqual({ atMs: 5000, playing: false });
  });

  it("the e2e flag hands the shell tests the engine", () => {
    localStorage.setItem("nuvo.e2e", "1");
    const engine = bootLyrics();
    expect((window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics).toBe(engine);
    delete (window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics;
  });

  it("an old offset map goes to the daemon at link time", async () => {
    localStorage.setItem("nuvo_lyrics_session_v1", JSON.stringify({ state: { trackOffsets: { a: 300 } } }));
    bootLyrics();
    linkLyricsToPlayer();
    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/v1/lyrics/offsets"))).toBe(true));
  });
});
