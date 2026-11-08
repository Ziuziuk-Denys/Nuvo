import { describe, expect, it } from "vitest";
import { loopJump, setPoint } from "./abLoop";
import { SLEEP_FADE_MS, msUntilSleep, planSleep, sleepVolume } from "./sleepTimer";

describe("sleep timer", () => {
  it("timed sleep counts down from the plan", () => {
    const plan = planSleep({ kind: "minutes", minutes: 15 }, 1000);
    expect(msUntilSleep(plan, 1000, 99_999, false)).toBe(900_000);
    expect(msUntilSleep(plan, 2_000_000, 99_999, false)).toBe(0);
  });

  it("track and queue targets follow the track end", () => {
    expect(msUntilSleep(planSleep({ kind: "end_of_track" }, 0), 0, 5000, false)).toBe(5000);
    expect(msUntilSleep(planSleep({ kind: "end_of_queue" }, 0), 0, 5000, false)).toBeNull();
    expect(msUntilSleep(planSleep({ kind: "end_of_queue" }, 0), 0, 5000, true)).toBe(5000);
  });

  it("fades linearly over the last 30 seconds", () => {
    expect(sleepVolume(SLEEP_FADE_MS * 2)).toBe(1);
    expect(sleepVolume(SLEEP_FADE_MS / 2)).toBe(0.5);
    expect(sleepVolume(0)).toBe(0);
    expect(sleepVolume(-5)).toBe(0);
  });
});

describe("A-B loop", () => {
  it("loops back to A at B", () => {
    let loop = setPoint({ a: null, b: null }, "a", 10_000);
    loop = setPoint(loop, "b", 20_000);
    expect(loopJump(loop, 19_999)).toBeNull();
    expect(loopJump(loop, 20_000)).toBe(10_000);
  });

  it("swaps a B set before A and enforces a minimum length", () => {
    expect(setPoint({ a: 10_000, b: null }, "b", 5_000)).toEqual({ a: 5_000, b: 10_000 });
    expect(setPoint({ a: 10_000, b: null }, "b", 10_100)).toEqual({ a: 10_000, b: 10_500 });
  });

  it("moving A past B clears B", () => {
    expect(setPoint({ a: 1000, b: 5000 }, "a", 6000)).toEqual({ a: 6000, b: null });
    expect(loopJump({ a: 1000, b: null }, 99_999)).toBeNull();
  });

  it("resetting A to the same value keeps minimum-length B", () => {
    const loop = setPoint({ a: 10_000, b: 10_500 }, "a", 10_000);
    expect(loop).toEqual({ a: 10_000, b: 10_500 });
  });
});
