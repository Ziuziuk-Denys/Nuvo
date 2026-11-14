import { describe, expect, it } from "vitest";
import { MAX_ANIMATED, planFlip, type Box } from "./flip";

const VIEW = { top: 0, bottom: 600 };
const row = (y: number): Box => ({ x: 0, y, width: 400, height: 64 });
const boxes = (entries: [string, number][]) => new Map(entries.map(([key, y]) => [key, row(y)]));

describe("planFlip", () => {
  it("glides items that stay in view and leaves still ones alone", () => {
    const plan = planFlip(
      boxes([
        ["a", 0],
        ["b", 68],
        ["c", 136],
      ]),
      boxes([
        ["b", 0],
        ["a", 68],
        ["c", 136],
      ]),
      VIEW,
    );
    expect(plan).toEqual({
      moves: [
        { key: "b", dx: 0, dy: 68 },
        { key: "a", dx: 0, dy: -68 },
      ],
      enters: [],
      exits: [],
    });
  });

  it("fades in what arrives and fades out what was filtered away", () => {
    const plan = planFlip(
      boxes([
        ["a", 0],
        ["b", 68],
      ]),
      boxes([
        ["b", 0],
        ["c", 68],
      ]),
      VIEW,
    );
    expect(plan).toEqual({ moves: [{ key: "b", dx: 0, dy: 68 }], enters: ["c"], exits: ["a"] });
  });

  it("fades a jump longer than the view instead of flying it across", () => {
    const plan = planFlip(
      boxes([
        ["a", 0],
        ["z", 4000],
      ]),
      boxes([
        ["z", 0],
        ["a", 4000],
      ]),
      VIEW,
    );
    expect(plan).toEqual({ moves: [], enters: ["z"], exits: ["a"] });
  });

  it("ignores items that are off screen before and after", () => {
    expect(planFlip(boxes([["a", 900]]), boxes([["a", 1000]]), VIEW)).toEqual({ moves: [], enters: [], exits: [] });
  });

  it("gives up on changes too large to follow", () => {
    const after = boxes(Array.from({ length: MAX_ANIMATED + 1 }, (_, index) => [`k${index}`, (index % 8) * 68] as [string, number]));
    expect(planFlip(new Map(), after, VIEW)).toBeNull();
  });
});
