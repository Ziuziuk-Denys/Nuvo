import { describe, expect, it } from "vitest";
import { createGovernor } from "./governor";

const run = (governor: ReturnType<typeof createGovernor>, count: number, deltaMs: number) => {
  let last: number | null = null;
  for (let i = 0; i < count; i++) last = governor.frame(deltaMs) ?? last;
  return last;
};

describe("render scale governor", () => {
  it("keeps full size while frames arrive on time, on any refresh rate", () => {
    const governor = createGovernor();
    expect(run(governor, 600, 16.7)).toBeNull();
    expect(run(governor, 600, 6.9)).toBeNull();
    expect(governor.scale).toBe(1);
  });

  it("steps down when frames keep missing, never below half", () => {
    const governor = createGovernor();
    expect(run(governor, 60, 33)).toBe(0.75);
    expect(run(governor, 60, 33)).toBe(0.5);
    expect(run(governor, 300, 33)).toBeNull();
    expect(governor.scale).toBe(0.5);
  });

  it("ignores a single hitch such as a tab switch", () => {
    const governor = createGovernor();
    run(governor, 30, 16.7);
    governor.frame(400);
    expect(run(governor, 30, 16.7)).toBeNull();
  });

  it("climbs back after a long run of clean frames", () => {
    const governor = createGovernor();
    run(governor, 60, 33);
    expect(governor.scale).toBe(0.75);
    expect(run(governor, 599, 16.7)).toBeNull();
    expect(run(governor, 1, 16.7)).toBe(1);
  });
});
