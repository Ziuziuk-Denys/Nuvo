import { describe, expect, it } from "vitest";
import { WINDOW, createExtractor } from "./features";
import { analyse, downmix, windowAt } from "./offline";

const RATE = 48_000;

function toneBuffer(seconds: number): Float32Array {
  const out = new Float32Array(seconds * RATE);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 90 * i) / RATE) + (i % 24_000 < 64 ? 0.7 : 0);
  return out;
}

describe("offline analysis", () => {
  it("returns one frame per output frame", () => {
    expect(analyse(toneBuffer(4), RATE, 1000, 3000, 30)).toHaveLength(60);
  });

  it("matches stepping the extractor by hand", () => {
    const pcm = toneBuffer(3);
    const frames = analyse(pcm, RATE, 0, 1000, 30);
    const extractor = createExtractor(RATE);
    const window = new Float32Array(WINDOW);
    for (let i = 0; i < frames.length; i++) {
      const centre = Math.round(((i * 1000) / 30 / 1000) * RATE);
      for (let j = 0; j < WINDOW; j++) {
        const at = centre - WINDOW / 2 + j;
        window[j] = at >= 0 && at < pcm.length ? pcm[at] : 0;
      }
      expect(frames[i]).toEqual(extractor.step(window, 1000 / 30));
    }
  });

  it("warms up before the range so the first frame is already moving", () => {
    const frames = analyse(toneBuffer(5), RATE, 3000, 3500, 30);
    expect(frames[0].bass).toBeGreaterThan(0.9);
  });
});

describe("window at a moment", () => {
  it("centres the window on the moment and pads outside the song with silence", () => {
    const pcm = Float32Array.from({ length: 10_000 }, (_, i) => i);
    const out = new Float32Array(WINDOW);
    windowAt(pcm, 1_000, 5_000, out);
    expect(out[WINDOW / 2]).toBe(5_000);
    expect(out[0]).toBe(5_000 - WINDOW / 2);
    windowAt(pcm, 1_000, 0, out);
    expect(out[0]).toBe(0);
    expect(out[WINDOW / 2]).toBe(0);
    expect(out[WINDOW / 2 + 1]).toBe(1);
  });
});

describe("downmix", () => {
  it("averages the channels", () => {
    const left = new Float32Array([1, 0, 0.5]);
    const right = new Float32Array([0, 1, 0.5]);
    const buffer = { numberOfChannels: 2, getChannelData: (i: number) => (i === 0 ? left : right) };
    expect([...downmix(buffer)]).toEqual([0.5, 0.5, 0.5]);
  });
});
