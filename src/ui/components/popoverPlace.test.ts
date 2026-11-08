import { afterEach, describe, expect, it } from "vitest";
import { placeOn } from "./Popover";

const rect =
  (top: number, bottom: number, left = 900, width = 40) =>
  () =>
    ({ top, bottom, left, right: left + width, width, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function anchorIn(island: boolean, top: number, bottom: number): HTMLElement {
  const bar = document.createElement("div");
  if (island) bar.setAttribute("data-island", "");
  bar.getBoundingClientRect = rect(top - 10, bottom + 10, 70, 1000);
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = rect(top, bottom);
  bar.append(anchor);
  document.body.append(bar);
  return anchor;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("popover placement", () => {
  it("keeps a player panel above the bar and caps it at the room there, at 1100 x 705", () => {
    Object.assign(window, { innerWidth: 1100, innerHeight: 705 });
    const place = placeOn(anchorIn(true, 645, 685), 300, 635);
    expect(place.below).toBe(false);
    expect(place.edge).toBe(705 - 635 + 10);
    expect(place.room).toBe(635 - 10 - 12);
  });

  it("flips an ordinary anchor near the top below it", () => {
    Object.assign(window, { innerWidth: 1100, innerHeight: 705 });
    const place = placeOn(anchorIn(false, 40, 80), 300, 300);
    expect(place.below).toBe(true);
    expect(place.room).toBeGreaterThanOrEqual(300);
  });
});
