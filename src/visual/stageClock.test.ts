import { describe, expect, it } from "vitest";
import { createStageClock } from "./stageClock";

const FRAME = 1000 / 60;

function play(clock: ReturnType<typeof createStageClock>, from: { atMs: number; stamp: number }, frames: number, speed = 1, playing = true) {
  for (let i = 0; i < frames; i++) clock.sample({ atMs: from.atMs + i * FRAME * speed, playing, stamp: from.stamp + i * FRAME });
}

describe("stage clock", () => {
  it("follows the page within a millisecond between samples", () => {
    const clock = createStageClock();
    play(clock, { atMs: 10_000, stamp: 1_000 }, 30);
    const lastStamp = 1_000 + 29 * FRAME;
    expect(clock.read(lastStamp + 8).atMs).toBeCloseTo(10_000 + 29 * FRAME + 8, 0);
  });

  it("does not run ahead while the page says the song is stuck", () => {
    const clock = createStageClock();
    play(clock, { atMs: 10_000, stamp: 1_000 }, 30);
    const stuckAt = 10_000 + 29 * FRAME;
    for (let i = 1; i <= 60; i++) clock.sample({ atMs: stuckAt, playing: true, stamp: 1_000 + (29 + i) * FRAME });
    expect(clock.read(1_000 + 89 * FRAME + 5).atMs).toBeLessThan(stuckAt + 2 * FRAME);
  });

  it("keeps time running when the page stops sending for a while", () => {
    const clock = createStageClock();
    play(clock, { atMs: 10_000, stamp: 1_000 }, 30);
    const last = { atMs: 10_000 + 29 * FRAME, stamp: 1_000 + 29 * FRAME };
    expect(clock.read(last.stamp + 400).atMs).toBeCloseTo(last.atMs + 400, 0);
  });

  it("learns a slower playback speed", () => {
    const clock = createStageClock();
    play(clock, { atMs: 10_000, stamp: 1_000 }, 60, 0.75);
    const last = { atMs: 10_000 + 59 * FRAME * 0.75, stamp: 1_000 + 59 * FRAME };
    expect(clock.read(last.stamp + 200).atMs).toBeCloseTo(last.atMs + 150, -1);
  });

  it("follows a seek back at once and holds still while paused", () => {
    const clock = createStageClock();
    play(clock, { atMs: 10_000, stamp: 1_000 }, 30);
    clock.sample({ atMs: 3_000, playing: true, stamp: 1_600 });
    expect(clock.read(1_600).atMs).toBe(3_000);
    clock.sample({ atMs: 3_000, playing: false, stamp: 1_700 });
    expect(clock.read(5_000)).toEqual({ atMs: 3_000, playing: false });
  });

  it("never steps back a few milliseconds for frame jitter", () => {
    const clock = createStageClock();
    play(clock, { atMs: 10_000, stamp: 1_000 }, 30);
    const shown = clock.read(1_000 + 29 * FRAME + 10).atMs;
    clock.sample({ atMs: 10_000 + 29 * FRAME + 4, playing: true, stamp: 1_000 + 29 * FRAME + 10 });
    expect(clock.read(1_000 + 29 * FRAME + 10).atMs).toBeGreaterThanOrEqual(shown);
  });
});
