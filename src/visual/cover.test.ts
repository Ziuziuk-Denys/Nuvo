import { expect, it } from "vitest";
import { centreSquare } from "./cover";

it("a cover that is not square keeps its shape: the middle square is taken", () => {
  expect(centreSquare(1280, 720)).toEqual({ x: 280, y: 0, side: 720 });
  expect(centreSquare(600, 900)).toEqual({ x: 0, y: 150, side: 600 });
  expect(centreSquare(512, 512)).toEqual({ x: 0, y: 0, side: 512 });
});
