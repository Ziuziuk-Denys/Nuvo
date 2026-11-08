import { afterEach, describe, expect, it } from "vitest";
import { shiftLines } from "./timing";
import { LineTracker } from "./tracker";
import { fakeAudio, fakeFrames, line } from "./test/fakes";

const lines = [line(1000), line(4500), line(9000)];

function setup(positionMs = 0, playing = false) {
  const audio = fakeAudio(positionMs, playing);
  const frames = fakeFrames();
  const published: Array<number | null> = [];
  let now = 0;
  const tracker = new LineTracker({
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: () => now,
    onLine: (index) => published.push(index),
  });
  tracker.connect(audio);
  const release = tracker.observe();
  return { release, tracker, audio, frames, published, advance: (ms: number) => (now += ms) };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => setHidden(false));

describe("LineTracker", () => {
  it("29 schedules no frame while paused", () => {
    const s = setup(0, false);
    s.tracker.setLines(lines, true, 200_000);
    expect(s.frames.pending()).toBe(0);
  });

  it("a paused, restored position reaches the view clock without a play or a seek", () => {
    const s = setup(42_000, false);
    s.tracker.setLines(lines, true, 200_000);
    expect(s.tracker.clock.read()).toEqual({ atMs: 42_000, playing: false });
    expect(s.published).toEqual([]);
  });

  it("a view's frame work rides the one loop: per frame while playing, per event while paused, never while hidden", () => {
    const s = setup(2000, true);
    s.tracker.setLines(lines, true, 200_000);
    let frames = 0;
    const off = s.tracker.onFrame(() => (frames += 1));
    expect(frames).toBe(1);
    expect(s.frames.pending()).toBe(1);
    s.frames.run();
    s.frames.run();
    expect(frames).toBe(3);
    expect(s.frames.pending()).toBe(1);

    s.audio.state = { positionMs: 9500, playing: false };
    s.audio.emit();
    expect(s.frames.pending()).toBe(0);
    const paused = frames;
    expect(paused).toBeGreaterThan(3);
    s.audio.state = { positionMs: 9700, playing: false };
    s.audio.emit();
    expect(frames).toBeGreaterThan(paused);

    s.audio.state = { positionMs: 9700, playing: true };
    s.audio.emit();
    setHidden(true);
    expect(s.frames.pending()).toBe(0);
    setHidden(false);

    off();
    const before = frames;
    s.frames.run();
    expect(frames).toBe(before);
  });

  it("reads the audio clock through the port", () => {
    const s = setup(5000, true);
    Object.assign(s.audio, { audioTime: () => ({ nowMs: 100, latencyMs: 40 }) });
    s.tracker.setLines(lines, true, 200_000);
    expect(s.tracker.clock.read().atMs).toBe(4960);
  });

  it("never runs for lyrics without timing", () => {
    const s = setup(0, true);
    s.tracker.setLines([], false, 200_000);
    expect(s.frames.pending()).toBe(0);
  });

  it("evaluates once per frame while playing and publishes only changes", () => {
    const s = setup(0, true);
    expect(s.tracker.setLines(lines, true, 200_000)).toBeNull();
    expect(s.frames.pending()).toBe(1);
    s.audio.state.positionMs = 500;
    s.frames.run();
    s.audio.state.positionMs = 600;
    s.frames.run();
    expect(s.published).toEqual([0]);
    expect(s.frames.pending()).toBe(1);
  });

  it("33 a pause stops the loop after one last evaluation; a seek while paused evaluates once", () => {
    const s = setup(0, true);
    s.tracker.setLines(lines, true, 200_000);
    s.audio.state = { positionMs: 5000, playing: false };
    s.audio.emit();
    expect(s.frames.pending()).toBe(0);
    expect(s.published).toEqual([1]);
    s.audio.state.positionMs = 9500;
    s.audio.emit();
    expect(s.published).toEqual([1, 2]);
    expect(s.frames.pending()).toBe(0);
  });

  it("34 new lines while paused return the recomputed line without a frame", () => {
    const s = setup(4000, false);
    expect(s.tracker.setLines(lines, true, 200_000)).toBe(1);
    expect(s.tracker.setLines(shiftLines(lines, 500), true, 200_000)).toBe(0);
    expect(s.frames.pending()).toBe(0);
    expect(s.published).toEqual([]);
  });

  it("feeds the view clock from each evaluation", () => {
    const s = setup(5000, true);
    s.tracker.setLines(lines, true, 200_000);
    s.frames.run();
    s.advance(1000);
    expect(s.tracker.clock.read()).toEqual({ atMs: 6000, playing: true });
  });

  it("dispose cancels the frame and stops listening", () => {
    const s = setup(0, true);
    s.tracker.setLines(lines, true, 200_000);
    s.tracker.dispose();
    expect(s.frames.pending()).toBe(0);
    s.audio.state.positionMs = 5000;
    s.audio.emit();
    expect(s.published).toEqual([]);
  });

  it("stops the loop while the document is hidden and resumes when it shows", () => {
    const s = setup(0, true);
    s.tracker.setLines(lines, true, 200_000);
    expect(s.frames.pending()).toBe(1);
    setHidden(true);
    expect(s.frames.pending()).toBe(0);
    s.audio.state.positionMs = 5000;
    s.audio.emit();
    expect(s.frames.pending()).toBe(0);
    setHidden(false);
    expect(s.frames.pending()).toBe(1);
    expect(s.published).toContain(1);
  });

  it("runs only while something observes it", () => {
    const s = setup(0, true);
    s.release();
    s.tracker.setLines(lines, true, 200_000);
    expect(s.frames.pending()).toBe(0);
    const again = s.tracker.observe();
    expect(s.frames.pending()).toBe(1);
    again();
    expect(s.frames.pending()).toBe(0);
  });

  it("dispose removes the visibility listener", () => {
    const s = setup(0, true);
    s.tracker.setLines(lines, true, 200_000);
    s.tracker.dispose();
    setHidden(true);
    setHidden(false);
    expect(s.frames.pending()).toBe(0);
  });

  it("scales the view clock by the playback rate", () => {
    const audio = fakeAudio(5000, true);
    const frames = fakeFrames();
    let now = 0;
    const tracker = new LineTracker({ requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, now: () => now, onLine: () => undefined });
    Object.assign(audio, { rate: () => 1.5 });
    tracker.connect(audio);
    tracker.observe();
    tracker.setLines(lines, true, 200_000);
    frames.run();
    now += 1000;
    audio.state.positionMs = 6500;
    frames.run();
    now += 100;
    expect(tracker.clock.read().atMs).toBeCloseTo(6650, 5);
  });
});
