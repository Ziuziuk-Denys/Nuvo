import { beforeEach, expect, it, vi } from "vitest";
import type { Track } from "../../ports/player";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  engine: { playTrack: vi.fn(), seek: vi.fn(), pause: vi.fn() },
}));

vi.mock("../../ports/player", () => ({ playerEngine: mocks.engine, usePlayerStore: { getState: () => mocks.state } }));

const { DEMO_TRACK, playDemo, restorePlayback } = await import("./demoSong");

const song = (id: string): Track => ({ id, title: id, artists: "A", coverUrl: "", durationMs: 200_000 });

beforeEach(() => {
  vi.clearAllMocks();
});

it("plays a song with verified synced lyrics for the tour, then returns to the queue, the song and the moment it left", () => {
  const queue = [song("a"), song("b"), song("c")];
  mocks.state = {
    currentTrack: queue[1],
    queue,
    currentIndex: 1,
    positionMs: 42_000,
    playbackContext: "playlist:1",
    playbackContextCover: "c.jpg",
    status: "playing",
  };
  const before = playDemo();
  expect(mocks.engine.playTrack).toHaveBeenCalledWith(DEMO_TRACK);
  restorePlayback(before);
  expect(mocks.engine.playTrack).toHaveBeenLastCalledWith(queue[1], queue, "playlist:1", "c.jpg", 1);
  expect(mocks.engine.seek).toHaveBeenCalledWith(42_000);
  expect(mocks.engine.pause).not.toHaveBeenCalled();
});

it("leaves a song paused that was paused before the tour", () => {
  const queue = [song("a")];
  mocks.state = { currentTrack: queue[0], queue, currentIndex: 0, positionMs: 5_000, playbackContext: null, playbackContextCover: null, status: "paused" };
  restorePlayback(playDemo());
  expect(mocks.engine.pause).toHaveBeenCalledOnce();
});

it("stops the demo when nothing was playing before", () => {
  mocks.state = { currentTrack: null, queue: [], currentIndex: -1, positionMs: 0, playbackContext: null, playbackContextCover: null, status: "idle" };
  restorePlayback(playDemo());
  expect(mocks.engine.playTrack).toHaveBeenCalledOnce();
  expect(mocks.engine.pause).toHaveBeenCalledOnce();
});
