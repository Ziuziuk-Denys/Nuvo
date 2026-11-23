import { describe, expect, it } from "vitest";
import { createCuts } from "./cuts";

describe("cuts", () => {
  it("counts every hit as a cut and opens a new shot at most every 450 ms", () => {
    const cuts = createCuts();
    cuts.step(1_000, true);
    expect(cuts.step(1_200, true)).toEqual({ cuts: 2, cutAgeMs: 0, shots: 1, shotAgeMs: 200 });
    expect(cuts.step(1_450, true)).toEqual({ cuts: 3, cutAgeMs: 0, shots: 2, shotAgeMs: 0 });
    expect(cuts.step(1_500, false)).toEqual({ cuts: 3, cutAgeMs: 50, shots: 2, shotAgeMs: 50 });
  });

  it.each([
    ["a seek back", 1_000],
    ["the start of the next song", 0],
  ])("never reports a negative age after %s", (_, atMs) => {
    const cuts = createCuts();
    cuts.step(200_000, true);
    const { cutAgeMs, shotAgeMs } = cuts.step(atMs, false);
    expect(cutAgeMs).toBeGreaterThanOrEqual(0);
    expect(shotAgeMs).toBeGreaterThanOrEqual(0);
  });

  it("opens a new shot on the first hit after a seek back", () => {
    const cuts = createCuts();
    cuts.step(200_000, true);
    cuts.step(1_000, false);
    expect(cuts.step(1_100, true)).toEqual({ cuts: 2, cutAgeMs: 0, shots: 2, shotAgeMs: 0 });
  });

  it("settles at once instead of replaying the hit after a seek back", () => {
    const cuts = createCuts();
    cuts.step(200_000, true);
    expect(cuts.step(1_000, false).shotAgeMs).toBeGreaterThan(6_000);
  });
});
