import { describe, expect, it } from "vitest";
import { isNeutral, presetOf, TEMPO_PRESETS } from "./tempo";

describe("tempo presets", () => {
  it("holds the specified values", () => {
    expect(TEMPO_PRESETS.normal).toEqual({ rate: 1, pitchSemitones: 0, pitchLinked: true, reverb: null });
    expect(TEMPO_PRESETS.slowed).toMatchObject({ rate: 0.85, pitchLinked: true, reverb: null });
    expect(TEMPO_PRESETS.slowedReverb).toMatchObject({ rate: 0.85, pitchLinked: true, reverb: 0.45 });
    expect(TEMPO_PRESETS.spedUp).toMatchObject({ rate: 1.25, pitchLinked: true, reverb: null });
    expect(TEMPO_PRESETS.nightcore).toEqual({ rate: 1.25, pitchSemitones: 3, pitchLinked: false, reverb: null });
    expect(TEMPO_PRESETS.daycore).toEqual({ rate: 0.8, pitchSemitones: -2, pitchLinked: false, reverb: 0.3 });
  });

  it("linked presets carry the pitch the engine derives from the rate", () => {
    expect(TEMPO_PRESETS.slowed.pitchSemitones).toBe(Number((12 * Math.log2(0.85)).toFixed(1)));
  });

  it("matches a preset within tolerance", () => {
    expect(presetOf({ ...TEMPO_PRESETS.nightcore, rate: 1.253, pitchSemitones: 3.04 })).toBe("nightcore");
    expect(presetOf({ ...TEMPO_PRESETS.slowedReverb, reverb: 0.46 })).toBe("slowedReverb");
  });

  it("returns null for a custom mix", () => {
    expect(presetOf({ ...TEMPO_PRESETS.slowed, rate: 0.9 })).toBeNull();
    expect(presetOf({ ...TEMPO_PRESETS.slowed, reverb: 0.2 })).toBeNull();
    expect(presetOf({ ...TEMPO_PRESETS.nightcore, pitchLinked: true })).toBeNull();
  });

  it("tells reverb off from reverb on", () => {
    expect(presetOf({ ...TEMPO_PRESETS.slowedReverb, reverb: null })).toBe("slowed");
  });

  it("detects the neutral setting", () => {
    expect(isNeutral(TEMPO_PRESETS.normal)).toBe(true);
    expect(isNeutral(TEMPO_PRESETS.slowed)).toBe(false);
  });
});
