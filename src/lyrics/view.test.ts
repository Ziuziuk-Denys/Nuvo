import { describe, expect, it } from "vitest";
import { LyricsClock, pinTopOnNewTrack, releaseTopPin, wordProgress } from "./view";

function clockAt(start = 0) {
  let now = start;
  return { clock: new LyricsClock(() => now), advance: (ms: number) => (now += ms) };
}

function audioClock(latencyMs = 0) {
  const audio = { nowMs: 1000, latencyMs };
  let wall = 0;
  let live = true;
  const clock = new LyricsClock(
    () => wall,
    () => (live ? audio : null),
  );
  return {
    clock,
    audio,
    advanceAudio: (ms: number) => (audio.nowMs += ms),
    advanceWall: (ms: number) => (wall += ms),
    setLive: (next: boolean) => (live = next),
  };
}

describe("LyricsClock on the audio clock", () => {
  it("follows audio time, not the wall clock", () => {
    const { clock, advanceAudio, advanceWall } = audioClock();
    clock.report(5000, true, 200_000);
    advanceWall(900);
    expect(clock.read().atMs).toBe(5000);
    advanceAudio(250);
    expect(clock.read().atMs).toBe(5250);
  });

  it("shows what is heard: the position minus the output latency", () => {
    const { clock, advanceAudio } = audioClock(80);
    clock.report(5000, true, 200_000);
    expect(clock.read().atMs).toBe(4920);
    advanceAudio(100);
    expect(clock.read().atMs).toBe(5020);
  });

  it("latency scales with the rate: queued audio holds more song at a higher speed", () => {
    const { clock, advanceAudio } = audioClock(100);
    clock.report(5000, true, 200_000, 1.5);
    expect(clock.read().atMs).toBe(4850);
    advanceAudio(200);
    expect(clock.read().atMs).toBe(5150);
  });

  it("a rate change keeps the position and changes the slope", () => {
    const { clock, advanceAudio } = audioClock();
    clock.report(5000, true, 200_000, 1);
    advanceAudio(1000);
    clock.report(6000, true, 200_000, 0.5);
    expect(clock.read().atMs).toBe(6000);
    advanceAudio(1000);
    expect(clock.read().atMs).toBe(6500);
  });

  it("a seek lands at once, forward and back", () => {
    const { clock, advanceAudio } = audioClock();
    clock.report(5000, true, 200_000);
    advanceAudio(100);
    clock.report(90_000, true, 200_000);
    expect(clock.read().atMs).toBe(90_000);
    advanceAudio(100);
    clock.report(1000, true, 200_000);
    expect(clock.read().atMs).toBe(1000);
  });

  it("a seek while paused moves the clock even by a few ms", () => {
    const { clock } = audioClock();
    clock.report(5000, false, 200_000);
    clock.report(5020, false, 200_000);
    expect(clock.read().atMs).toBe(5020);
  });

  it("pause freezes it however far audio time runs, resume goes on from the position", () => {
    const { clock, advanceAudio } = audioClock();
    clock.report(5000, true, 200_000);
    advanceAudio(500);
    clock.report(5500, false, 200_000);
    advanceAudio(4000);
    expect(clock.read()).toEqual({ atMs: 5500, playing: false });
    clock.report(5500, true, 200_000);
    expect(clock.read().atMs).toBe(5500);
    advanceAudio(100);
    expect(clock.read().atMs).toBe(5600);
  });

  it("the element's jitter does not shake it, a real drift is pulled in without a jump", () => {
    const { clock, advanceAudio } = audioClock();
    clock.report(5000, true, 200_000);
    let position = 5000;
    let last = clock.read().atMs;
    for (let frame = 0; frame < 300; frame += 1) {
      advanceAudio(16);
      position += 16;
      clock.report(position + 40, true, 200_000);
      const now = clock.read().atMs;
      expect(now - last).toBeGreaterThan(0);
      expect(now - last).toBeLessThan(16 + 4);
      last = now;
    }
    expect(Math.abs(last - (position + 40))).toBeLessThan(1);
  });

  it("falls back to the wall clock when the context stops, and comes back without a jump", () => {
    const { clock, advanceAudio, advanceWall, setLive } = audioClock();
    clock.report(5000, true, 200_000);
    setLive(false);
    clock.report(5000, true, 200_000);
    advanceWall(200);
    expect(clock.read().atMs).toBe(5200);
    clock.report(5200, true, 200_000);
    setLive(true);
    clock.report(5200, true, 200_000);
    advanceAudio(100);
    expect(clock.read().atMs).toBe(5300);
  });

  it("never reads below zero", () => {
    const { clock } = audioClock(120);
    clock.report(50, true, 200_000);
    expect(clock.read().atMs).toBe(0);
  });
});

describe("LyricsClock", () => {
  it("extrapolates at the playback rate without re-anchoring", () => {
    const { clock, advance } = clockAt();
    clock.report(5000, true, 200_000, 2);
    advance(1000);
    expect(clock.read().atMs).toBe(7000);
    clock.report(7000, true, 200_000, 2);
    advance(500);
    expect(clock.read().atMs).toBe(8000);
    clock.report(8000, true, 200_000, 0.5);
    advance(1000);
    expect(clock.read().atMs).toBe(8500);
  });

  it("36 a paused clock does not move", () => {
    const { clock, advance } = clockAt();
    clock.report(5000, false, 200_000);
    advance(2000);
    expect(clock.read()).toEqual({ atMs: 5000, playing: false });
  });

  it("37 extrapolates while playing and resyncs at once only past 60 ms", () => {
    const { clock, advance } = clockAt();
    clock.report(5000, true, 200_000);
    advance(1000);
    expect(clock.read().atMs).toBe(6000);
    clock.report(6400, true, 200_000);
    expect(clock.read().atMs).toBe(6400);

    const other = clockAt();
    other.clock.report(5000, true, 200_000);
    other.advance(1000);
    other.clock.report(6030, true, 200_000);
    expect(other.clock.read().atMs).toBeGreaterThanOrEqual(6000);
    expect(other.clock.read().atMs).toBeLessThan(6005);
  });

  it("stays inside [0, duration]", () => {
    const { clock, advance } = clockAt();
    clock.report(199_500, true, 200_000);
    advance(5000);
    expect(clock.read().atMs).toBe(200_000);
  });
});

describe("wordProgress", () => {
  it("38 is linear inside the word and clamped outside", () => {
    const word = { fromMs: 1000, toMs: 2000 };
    expect([999, 1500, 2000, 2500].map((ms) => wordProgress(word, ms))).toEqual([0, 50, 100, 100]);
    const instant = { fromMs: 1000, toMs: 1000 };
    expect([999, 1000].map((ms) => wordProgress(instant, ms))).toEqual([0, 100]);
  });
});

describe("new-song pin", () => {
  it("39 pins a new track that is loading or fresh, not one opened mid-song", () => {
    expect(pinTopOnNewTrack({ playerStatus: "loading", positionMs: 0 })).toBe(true);
    expect(pinTopOnNewTrack({ playerStatus: "idle", positionMs: 95_000 })).toBe(true);
    expect(pinTopOnNewTrack({ playerStatus: "playing", positionMs: 95_000 })).toBe(false);
  });

  it("40 releases once the new song really plays, or after 8 s", () => {
    const pinned = { playerStatus: "playing" as const, audioPaused: false, positionMs: 95_000, pinnedForMs: 500 };
    expect(releaseTopPin(pinned)).toBe(false);
    expect(releaseTopPin({ ...pinned, positionMs: 400 })).toBe(true);
    expect(releaseTopPin({ ...pinned, positionMs: 400, audioPaused: true })).toBe(false);
    expect(releaseTopPin({ ...pinned, pinnedForMs: 8000 })).toBe(true);
  });
});
