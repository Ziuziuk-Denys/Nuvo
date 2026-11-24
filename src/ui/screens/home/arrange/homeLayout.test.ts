// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { completeOrder, SECTIONS, useHomeLayout } from "./homeLayout";

beforeEach(() => useHomeLayout.getState().reset());

it("reads a saved order, drops unknown parts and puts new ones where they belong", () => {
  expect(completeOrder(undefined)).toEqual([...SECTIONS]);
  expect(completeOrder(["style", "gone", "mixes", "mixes", 4, "songs"])).toEqual(["style", "mixes", "continue", "mood", "songs", "memory", "like", "shuffle"]);
});

it("moves, hides and resets parts", () => {
  const { move, toggle, reset } = useHomeLayout.getState();
  move(0, 2);
  toggle("mood");
  expect(useHomeLayout.getState().order.slice(0, 3)).toEqual(["continue", "mood", "mixes"]);
  expect(useHomeLayout.getState().hidden).toEqual(["mood"]);
  toggle("mood");
  reset();
  expect(useHomeLayout.getState()).toMatchObject({ order: [...SECTIONS], hidden: [] });
});
