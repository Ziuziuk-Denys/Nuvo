import { describe, expect, it } from "vitest";
import { CALLOUT_WIDTH, EDGE, RING_PAD, dockLeft, dockOnTop, placeCallout, ringAround } from "./placement";

const view = { width: 1200, height: 780 };
const area = { top: 0, bottom: 690, width: 1200 };
const size = { width: CALLOUT_WIDTH, height: 60 };

const inside = (place: { x: number; y: number }, bounds: typeof area) =>
  place.x >= EDGE && place.x + size.width <= bounds.width - EDGE && place.y >= bounds.top + EDGE && place.y + size.height <= bounds.bottom - EDGE;

describe("ringAround", () => {
  it("pads the target and follows its corners", () => {
    expect(ringAround({ x: 100, y: 100, width: 40, height: 40, radius: 10 }, view)).toEqual({
      x: 100 - RING_PAD,
      y: 100 - RING_PAD,
      width: 40 + RING_PAD * 2,
      height: 40 + RING_PAD * 2,
      radius: 10 + RING_PAD,
    });
  });

  it("stays inside the window and never rounds past a pill", () => {
    const ring = ringAround({ x: 0, y: 760, width: 1200, height: 20, radius: 40 }, view);
    expect(ring.x).toBeGreaterThanOrEqual(0);
    expect(ring.y + ring.height).toBeLessThanOrEqual(view.height);
    expect(ring.x + ring.width).toBeLessThanOrEqual(view.width);
    expect(ring.radius).toBeLessThanOrEqual(ring.height / 2);
  });
});

describe("placeCallout", () => {
  it("goes under a target with room below, centred on it, the line straight down", () => {
    const ring = { x: 500, y: 100, width: 200, height: 40 };
    const place = placeCallout(ring, size, area);
    expect(place.side).toBe("below");
    expect(place.y).toBeGreaterThan(ring.y + ring.height);
    expect(place.x + size.width / 2).toBe(600);
    expect(place.from).toEqual({ x: 600, y: 140 });
    expect(place.to.x).toBe(600);
  });

  it("flips above a target near the bottom", () => {
    const ring = { x: 500, y: 640, width: 200, height: 40 };
    const place = placeCallout(ring, size, area);
    expect(place.side).toBe("above");
    expect(place.y + size.height).toBeLessThan(ring.y);
    expect(inside(place, area)).toBe(true);
  });

  it("takes the asked side when it fits and is level with the target", () => {
    const ring = { x: 6, y: 120, width: 58, height: 52 };
    const place = placeCallout(ring, size, area, "right");
    expect(place.side).toBe("right");
    expect(place.x).toBeGreaterThan(ring.x + ring.width);
    expect(place.from.y).toBe(place.to.y);
  });

  it("falls back from a side with no room", () => {
    const ring = { x: 1100, y: 300, width: 80, height: 40 };
    const place = placeCallout(ring, size, area, "right");
    expect(place.side).not.toBe("right");
    expect(inside(place, area)).toBe(true);
  });

  it("goes beside the panel a target sits in, not on top of it", () => {
    const panel = { x: 620, y: 200, width: 560, height: 420 };
    const ring = { x: 626, y: 206, width: 548, height: 408 };
    const place = placeCallout(ring, size, area, "left", panel);
    expect(place.side).toBe("left");
    expect(place.x + size.width).toBeLessThanOrEqual(panel.x);
  });

  it("never covers the target, even in a tight window", () => {
    const small = { top: 0, bottom: 400, width: 500 };
    const ring = { x: 20, y: 20, width: 460, height: 300 };
    const place = placeCallout(ring, size, small);
    const overlaps = place.x < ring.x + ring.width && ring.x < place.x + size.width && place.y < ring.y + ring.height && ring.y < place.y + size.height;
    expect(overlaps).toBe(false);
  });
});

describe("dockOnTop", () => {
  it("moves up when the outline reaches into the bottom band", () => {
    expect(dockOnTop({ x: 70, y: 710, width: 1124, height: 64 }, 780, 96)).toBe(true);
    expect(dockOnTop({ x: 70, y: 100, width: 300, height: 64 }, 780, 96)).toBe(false);
    expect(dockOnTop(null, 780, 96)).toBe(false);
  });
});

describe("dockLeft", () => {
  it("stays centred unless the outline sits under it", () => {
    const top = { top: 14, bottom: 104 };
    expect(dockLeft(null, 1200, 560, top)).toBe(320);
    expect(dockLeft({ x: 6, y: 100, width: 58, height: 52 }, 1200, 560, top)).toBe(320);
    // under the dock's columns but below its band
    expect(dockLeft({ x: 76, y: 120, width: 420, height: 50 }, 1200, 560, top)).toBe(320);
  });

  it("moves left of a tall panel on the right that reaches both bands", () => {
    const panel = { x: 864, y: 58, width: 314, height: 650 };
    const left = dockLeft(panel, 1200, 560, { top: 14, bottom: 104 });
    expect(left + 560).toBeLessThanOrEqual(panel.x);
    expect(left).toBeGreaterThanOrEqual(EDGE);
  });

  it("keeps the centre when the outline is as wide as the window", () => {
    expect(dockLeft({ x: 64, y: 700, width: 1130, height: 76 }, 1200, 560, { top: 14, bottom: 104 })).toBe(320);
  });
});
