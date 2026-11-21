import { expect, it } from "vitest";
import { kinetic } from "./kinetic";
import type { Ctx } from "./kit";

it("keeps the background steady from one beat cut to the next", () => {
  const signals = (cuts: number) =>
    kinetic.draw({
      ctx: {} as Ctx,
      lines: [],
      nowMs: 0,
      width: 100,
      height: 100,
      box: { x: 0, y: 0, width: 100, height: 100 },
      pulse: { cuts, cutAgeMs: 0, drive: 0, onset: 0, level: 0 },
    });
  expect(signals(1)).toEqual(signals(2));
});
