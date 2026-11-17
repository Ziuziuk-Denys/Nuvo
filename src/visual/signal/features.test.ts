import { describe, expect, it } from "vitest";
import { WINDOW, createExtractor, type Features } from "./features";

const RATE = 48_000;
const DT = 1000 / 60;

function run(signal: (sample: number) => number, seconds: number): Features[] {
  const extractor = createExtractor(RATE);
  const frames: Features[] = [];
  const window = new Float32Array(WINDOW);
  const count = Math.round((seconds * 1000) / DT);
  for (let frame = 1; frame <= count; frame++) {
    const end = Math.round((frame * DT * RATE) / 1000);
    for (let i = 0; i < WINDOW; i++) window[i] = signal(end - WINDOW + i);
    frames.push(extractor.step(window, DT));
  }
  return frames;
}

const silence = () => 0;
const tone =
  (hz: number, from = 0) =>
  (sample: number) =>
    sample < from ? 0 : 0.5 * Math.sin((2 * Math.PI * hz * sample) / RATE);
const clicks = (periodMs: number) => (sample: number) => {
  if (sample < 0) return 0;
  const inPeriod = sample % Math.round((periodMs * RATE) / 1000);
  return inPeriod < 96 ? (inPeriod % 2 ? 0.8 : -0.8) : 0;
};

function scalars(f: Features): number[] {
  return [f.bass, f.mid, f.high, f.level, f.flux, f.onset, f.beat, f.beatConfidence, f.beatMs];
}

describe("feature extractor", () => {
  it("stays finite and still on silence", () => {
    const frames = run(silence, 2);
    for (const frame of frames) {
      expect(scalars(frame).every(Number.isFinite)).toBe(true);
      expect([frame.bass, frame.mid, frame.high, frame.level, frame.flux, frame.onset]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(frame.bands.every((value) => value === 0)).toBe(true);
    }
  });

  it("raises bass but not highs for a low tone", () => {
    const last = run(tone(60), 1).at(-1)!;
    expect(last.bass).toBeGreaterThan(0.9);
    expect(last.high).toBe(0);
  });

  it("follows a new tone with the attack time constant", () => {
    const startSample = Math.round((10 * DT * RATE) / 1000);
    const frames = run(tone(80, startSample), 0.5);
    const first = frames.findIndex((frame) => frame.bass > 0);
    expect(frames[first].bass).toBeGreaterThan(0.3);
    expect(frames[first].bass).toBeLessThan(0.7);
    expect(frames[first + 6].bass).toBeGreaterThan(0.95);
  });

  it("fires one onset per click", () => {
    const frames = run(clicks(500), 6);
    const fired = frames.filter((frame) => frame.onset === 1).length;
    expect(fired).toBeGreaterThanOrEqual(11);
    expect(fired).toBeLessThanOrEqual(12);
  });

  it("keeps finding beats when a dense roll joins the kick", () => {
    const at = (ms: number) => Math.round((ms * RATE) / 1000);
    let seed = 7;
    const noise = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 1_073_741_824 - 1;
    };
    const kick = (sample: number) => {
      const inBeat = sample % at(450);
      return inBeat < at(40) ? Math.sin((2 * Math.PI * 60 * inBeat) / RATE) * (1 - inBeat / at(40)) : 0;
    };
    const roll = (sample: number) => {
      if (sample < at(3000)) return 0;
      const inHit = sample % at(60);
      return inHit < at(25) ? 0.35 * noise() * (1 - inHit / at(25)) : 0;
    };
    const frames = run((sample) => (sample < 0 ? 0 : kick(sample) + roll(sample)), 8);
    const onsetsMs = frames.map((frame, i) => (frame.onset === 1 ? i * DT : -1)).filter((ms) => ms >= 3500);
    const gaps = onsetsMs.slice(1).map((ms, i) => ms - onsetsMs[i]);
    expect(onsetsMs.length).toBeGreaterThan(5);
    expect(Math.max(...gaps)).toBeLessThan(900);
  });

  it("finds the beat period of a steady click track", () => {
    const last = run(clicks(500), 6).at(-1)!;
    expect(Math.abs(last.beatMs - 500)).toBeLessThan(20);
    expect(last.beatConfidence).toBeGreaterThan(0.6);
  });

  it("gives identical frames for identical input", () => {
    const signal = (sample: number) => tone(220)(sample) + clicks(430)(sample);
    const a = run(signal, 3);
    const b = run(signal, 3);
    expect(a).toEqual(b);
  });

  it("keeps the newest samples as the wave", () => {
    const frames = run(tone(440), 0.2);
    const last = frames.at(-1)!;
    expect(last.wave.length).toBe(512);
    expect(Math.max(...last.wave)).toBeGreaterThan(0.45);
  });
});
