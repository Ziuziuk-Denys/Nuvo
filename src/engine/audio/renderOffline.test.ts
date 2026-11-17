import { describe, expect, it } from "vitest";
import { pitchShiftFor, wavBytes } from "./renderOffline";

describe("offline render helpers", () => {
  it("lets a linked speed change the pitch and shifts an unlinked one back to the chosen pitch", () => {
    expect(pitchShiftFor({ rate: 1.25, semitones: 3.9, linked: true })).toBe(0);
    expect(pitchShiftFor({ rate: 0.8, semitones: 0, linked: false })).toBeCloseTo(-12 * Math.log2(0.8), 5);
    expect(pitchShiftFor({ rate: 1, semitones: -2, linked: false })).toBe(-2);
  });

  it("writes 16-bit stereo WAV with the right header and clipped samples", () => {
    const left = Float32Array.from([0, 1, -1, 2]);
    const right = Float32Array.from([0.5, -0.5, 0, -2]);
    const bytes = wavBytes([left, right], 48_000);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(view.getInt16(44 + 2, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(44 + 4, true)).toBe(32767);
    expect(view.getInt16(44 + 14, true)).toBe(-32767);
    expect(bytes.length).toBe(44 + 16);
  });
});
