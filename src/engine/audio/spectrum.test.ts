import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { FakeAnalyser, FakeContext, FakeNode } from "../test/fakeAudio";
import { SPECTRUM_BANDS, createSpectrumTap, type SpectrumFrame } from "./spectrum";

const FRAME_MS = 20;

function setup() {
  const context = new FakeContext();
  const source = new FakeNode(context, "gain");
  const tap = createSpectrumTap(context as unknown as AudioContext, source as unknown as AudioNode);
  const analysers = () => context.ofType("analyser") as FakeAnalyser[];
  const frames: SpectrumFrame[] = [];
  return { context, source, tap, analysers, frames };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("spectrum tap", () => {
  it("creates no analyser until the first subscriber and drops it with the last", () => {
    const s = setup();
    expect(s.analysers()).toHaveLength(0);
    const offA = s.tap.subscribe(() => undefined);
    const offB = s.tap.subscribe(() => undefined);
    expect(s.analysers()).toHaveLength(1);
    const analyser = s.analysers()[0];
    expect(analyser.fftSize).toBe(2048);
    expect(analyser.smoothingTimeConstant).toBe(0.8);
    expect(s.source.outputs).toContain(analyser);
    offA();
    expect(s.source.outputs).toContain(analyser);
    offB();
    expect(s.source.outputs).not.toContain(analyser);
  });

  it("does not touch requestAnimationFrame when nobody listens, and stops after the last leaves", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    const s = setup();
    vi.advanceTimersByTime(200);
    expect(raf).not.toHaveBeenCalled();
    const off = s.tap.subscribe((frame) => s.frames.push(frame));
    vi.advanceTimersByTime(FRAME_MS * 3);
    const delivered = s.frames.length;
    expect(delivered).toBeGreaterThan(0);
    off();
    vi.advanceTimersByTime(200);
    expect(s.frames.length).toBe(delivered);
    expect(vi.getTimerCount()).toBe(0);
    raf.mockRestore();
  });

  it("puts a single-bin peak in the band that holds its frequency", () => {
    const s = setup();
    s.tap.subscribe((frame) => s.frames.push(frame));
    const bin = 43; // 43 * 48000 / 2048 = 1007.8 Hz
    s.analysers()[0].bytes[bin] = 255;
    vi.advanceTimersByTime(FRAME_MS * 2);
    const bands = s.frames.at(-1)!.bands;
    expect(bands).toHaveLength(SPECTRUM_BANDS);
    const expected = Math.floor(Math.log(1007.8 / 20) / Math.log(Math.pow(1000, 1 / SPECTRUM_BANDS)));
    expect(bands[expected]).toBe(1);
    bands.forEach((value, i) => {
      if (i !== expected) expect(value).toBe(0);
    });
  });

  it("holds the clip flag for 500 ms after the last hot sample", () => {
    const s = setup();
    s.tap.subscribe((frame) => s.frames.push(frame));
    vi.advanceTimersByTime(FRAME_MS * 2);
    expect(s.frames.at(-1)!.clip).toBe(false);
    const wave = s.analysers()[0].wave;
    wave[100] = -0.995;
    vi.advanceTimersByTime(FRAME_MS);
    expect(s.frames.at(-1)!.clip).toBe(true);
    wave[100] = 0.5;
    vi.advanceTimersByTime(500 - 2 * FRAME_MS);
    expect(s.frames.at(-1)!.clip).toBe(true);
    vi.advanceTimersByTime(3 * FRAME_MS);
    expect(s.frames.at(-1)!.clip).toBe(false);
  });
});
