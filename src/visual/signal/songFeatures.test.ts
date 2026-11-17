import { describe, expect, it, vi } from "vitest";
import { WINDOW, createExtractor } from "./features";
import { windowAt } from "./offline";
import { createSongFeatures } from "./songFeatures";

const RATE = 48_000;
const FRAME_MS = 1000 / 60;

function clicks(seconds: number): Float32Array {
  const pcm = new Float32Array(RATE * seconds);
  const period = Math.round(0.5 * RATE);
  for (let i = 0; i < pcm.length; i++) {
    const inPeriod = i % period;
    pcm[i] = inPeriod < 96 ? (inPeriod % 2 ? 0.8 : -0.8) : 0.02 * Math.sin(i / 7);
  }
  return pcm;
}

describe("song features", () => {
  it("a paused frame is a pure function of the frozen time: redrawing it never steps the analysis", () => {
    const pcm = clicks(6);
    const window = new Float32Array(WINDOW);
    const extractor = createExtractor(RATE);
    const step = vi.spyOn(extractor, "step");
    const features = createSongFeatures(extractor);
    let atMs = 0;
    for (; atMs < 3_000; atMs += FRAME_MS) features.at(windowAt(pcm, RATE, atMs, window), atMs);
    const held = features.at(windowAt(pcm, RATE, atMs, window), atMs);
    const steps = step.mock.calls.length;
    for (let redraw = 0; redraw < 600; redraw++) expect(features.at(windowAt(pcm, RATE, atMs, window), atMs)).toBe(held);
    expect(step.mock.calls.length).toBe(steps);
  });

  it("steps the analysis by song time, so a slow page does not run its clock ahead", () => {
    const extractor = createExtractor(RATE);
    const step = vi.spyOn(extractor, "step");
    const features = createSongFeatures(extractor);
    const window = new Float32Array(WINDOW);
    features.at(window, 1_000);
    features.at(window, 1_040);
    features.at(window, 900);
    features.at(window, 5_000);
    expect(step.mock.calls.map((call) => call[1])).toEqual([FRAME_MS, 40, 0, 100]);
  });
});
