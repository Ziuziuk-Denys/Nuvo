import { describe, expect, it } from "vitest";
import { emptySelection, pickRow, selectAll, stepSelection, dropMissing } from "./trackSelection";

const order = ["a", "b", "c", "d", "e"];
const keys = (selection: { keys: ReadonlySet<string> }) => [...selection.keys].sort();

describe("track selection", () => {
  it("a plain click on a row with nothing selected changes nothing", () => {
    expect(pickRow(emptySelection, order, 2, {})).toBe(emptySelection);
  });

  it("ctrl click toggles one row and moves the anchor", () => {
    const one = pickRow(emptySelection, order, 1, { ctrl: true });
    expect(keys(one)).toEqual(["b"]);
    const two = pickRow(one, order, 3, { ctrl: true });
    expect(keys(two)).toEqual(["b", "d"]);
    expect(keys(pickRow(two, order, 1, { ctrl: true }))).toEqual(["d"]);
  });

  it("a plain click while something is selected selects only that row", () => {
    const some = pickRow(emptySelection, order, 0, { ctrl: true });
    expect(keys(pickRow(some, order, 3, {}))).toEqual(["d"]);
  });

  it("shift click selects the range from the anchor, in either direction", () => {
    const start = pickRow(emptySelection, order, 3, { ctrl: true });
    expect(keys(pickRow(start, order, 1, { shift: true }))).toEqual(["b", "c", "d"]);
    expect(keys(pickRow(start, order, 4, { shift: true }))).toEqual(["d", "e"]);
  });

  it("shift click with nothing selected starts at the clicked row", () => {
    expect(keys(pickRow(emptySelection, order, 2, { shift: true }))).toEqual(["c"]);
  });

  it("ctrl+shift click adds the range to what is selected", () => {
    const start = pickRow(pickRow(emptySelection, order, 0, { ctrl: true }), order, 3, { ctrl: true });
    expect(keys(pickRow(start, order, 4, { shift: true, ctrl: true }))).toEqual(["a", "d", "e"]);
  });

  it("select all takes every row", () => {
    expect(keys(selectAll(order))).toEqual(order);
  });

  it("arrow steps with shift grow and shrink the range around the anchor", () => {
    let selection = pickRow(emptySelection, order, 1, { ctrl: true });
    selection = stepSelection(selection, order, 1, 1);
    selection = stepSelection(selection, order, 2, 1);
    expect(keys(selection)).toEqual(["b", "c", "d"]);
    selection = stepSelection(selection, order, 3, -1);
    expect(keys(selection)).toEqual(["b", "c"]);
  });

  it("drops keys whose rows are gone", () => {
    const all = selectAll(order);
    expect(keys(dropMissing(all, ["a", "c"]))).toEqual(["a", "c"]);
    expect(dropMissing(all, order)).toBe(all);
  });
});
