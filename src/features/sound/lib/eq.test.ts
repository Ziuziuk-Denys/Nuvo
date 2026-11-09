import { describe, expect, it } from "vitest";
import { BUILT_IN_PRESETS, EQ_FREQUENCIES, autoPreamp, eqBands, logFrequencies, resolveProfile, sculpt, snapGain } from "./eq";

describe("equalizer model", () => {
  it("uses shelves at the ends and peaking bands between", () => {
    const bands = eqBands();
    expect(bands).toHaveLength(10);
    expect(bands[0].type).toBe("lowshelf");
    expect(bands[9].type).toBe("highshelf");
    expect(bands.slice(1, 9).every((b) => b.type === "peaking")).toBe(true);
    expect(bands.map((b) => b.frequency)).toEqual([...EQ_FREQUENCIES]);
  });

  it("every preset has ten gains inside the range", () => {
    for (const [name, gains] of Object.entries(BUILT_IN_PRESETS)) {
      expect(gains, name).toHaveLength(10);
      expect(
        gains.every((g) => g >= -12 && g <= 12),
        name,
      ).toBe(true);
    }
  });

  it("snaps and clamps", () => {
    expect(snapGain(3.26)).toBe(3.5);
    expect(snapGain(3.26, true)).toBeCloseTo(3.3, 5);
    expect(snapGain(40)).toBe(12);
    expect(snapGain(-40)).toBe(-12);
  });

  it("snapGain normalizes -0 to 0 and rounds fine step to 1 decimal", () => {
    expect(Object.is(snapGain(-0), 0)).toBe(true);
    expect(snapGain(-0.03, true)).toBe(0);
    const fineSnap = snapGain(3.25, true);
    expect(fineSnap).toBe(3.3);
    expect(String(fineSnap).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("auto preamp leaves 1 dB of the combined response peak", () => {
    expect(autoPreamp([0, 0, 0, 0, 6, 0, 0, 0, 0, 0])).toBeCloseTo(-5, 2);
    expect(autoPreamp([0, 0, 0, 0, 6, 6, 0, 0, 0, 0])).toBeLessThan(-6);
    expect(autoPreamp([6, 0, -3, 0, 0, 0, 0, 0, 0, 0])).toBeLessThan(-3.5);
    expect(autoPreamp([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(autoPreamp(BUILT_IN_PRESETS.bass_reducer)).toBe(0);
  });

  it("sculpt splits a drag between the two nearest bands by log distance", () => {
    const flat = Array(10).fill(0);
    const between = sculpt(flat, Math.sqrt(1000 * 2000), 4);
    expect(between[5]).toBeCloseTo(2, 5);
    expect(between[6]).toBeCloseTo(2, 5);
    expect(sculpt(flat, 1000, 4)[5]).toBeCloseTo(4, 5);
    expect(sculpt(flat, 10, 4)[0]).toBe(4);
    expect(sculpt(flat, 30000, 4)[9]).toBe(4);
  });

  it("sculpt returns gains unchanged for non-finite hz or deltaDb", () => {
    const flat = Array(10).fill(0);
    expect(sculpt(flat, Infinity, 4)).toEqual(flat);
    expect(sculpt(flat, NaN, 4)).toEqual(flat);
    expect(sculpt(flat, 1000, Infinity)).toEqual(flat);
    expect(sculpt(flat, 1000, NaN)).toEqual(flat);
  });

  it("log frequencies span 20 Hz to 20 kHz", () => {
    const f = logFrequencies(256);
    expect(f[0]).toBeCloseTo(20, 3);
    expect(f[255]).toBeCloseTo(20000, 0);
    expect(f[128]).toBeGreaterThan(600);
    expect(f[128]).toBeLessThan(700);
  });

  it("profile lookup prefers track, then artist (case-insensitive), then global", () => {
    expect(resolveProfile("t1", "Queen", { t1: "a" }, { queen: "b" }, "g")).toBe("a");
    expect(resolveProfile("t2", "QUEEN", { t1: "a" }, { queen: "b" }, "g")).toBe("b");
    expect(resolveProfile(null, null, {}, {}, "g")).toBe("g");
  });
});
