import type { Side } from "./chapters";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Ring extends Box {
  radius: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface CalloutPlace extends Point {
  side: Side;
  /** The line runs from the outline to the card */
  from: Point;
  to: Point;
}

/** The part of the window a callout may use: the dock takes a band at the top or the bottom */
export interface Area {
  width: number;
  top: number;
  bottom: number;
}

export const RING_PAD = 6;
export const CALLOUT_WIDTH = 248;
export const EDGE = 12;
const GAP = 14;
const WINDOW_INSET = 3;
const FALLBACK_RADIUS = 10;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** The outline around a target: padded, kept inside the window, its corners following the target's own */
export function ringAround(box: Box & { radius?: number }, view: { width: number; height: number }): Ring {
  const left = Math.max(box.x - RING_PAD, WINDOW_INSET);
  const top = Math.max(box.y - RING_PAD, WINDOW_INSET);
  const right = Math.min(box.x + box.width + RING_PAD, view.width - WINDOW_INSET);
  const bottom = Math.min(box.y + box.height + RING_PAD, view.height - WINDOW_INSET);
  const width = right - left;
  const height = bottom - top;
  const radius = box.radius ? box.radius + RING_PAD : FALLBACK_RADIUS;
  return { x: left, y: top, width, height, radius: Math.min(radius, height / 2, width / 2) };
}

const ORDER: Side[] = ["below", "above", "right", "left"];

/*
  Where the callout card goes. The asked side first, then under, over, right, left: the first that fits the area.
  Beside a panel the target sits in, a side placement clears the whole panel. Nothing fits: under the target,
  pushed into the window but never over the outline
*/
export function placeCallout(ring: Box, size: { width: number; height: number }, area: Area, prefer?: Side, panel?: Box | null): CalloutPlace {
  const { width, height } = size;
  const minX = EDGE;
  const maxX = area.width - EDGE - width;
  const minY = area.top + EDGE;
  const maxY = area.bottom - EDGE - height;
  const around = panel ?? ring;
  const middleY = ring.y + ring.height / 2;
  const centreX = ring.x + ring.width / 2;

  const candidate = (side: Side): CalloutPlace => {
    if (side === "below" || side === "above") {
      const x = clamp(centreX - width / 2, minX, maxX);
      const y = side === "below" ? ring.y + ring.height + GAP : ring.y - GAP - height;
      const lineX = clamp(centreX, x + 16, x + width - 16);
      const from = { x: lineX, y: side === "below" ? ring.y + ring.height : ring.y };
      return { side, x, y, from, to: { x: lineX, y: side === "below" ? y : y + height } };
    }
    const x = side === "right" ? around.x + around.width + GAP : around.x - GAP - width;
    const y = clamp(middleY - height / 2, minY, maxY);
    // level where the card and the outline share a height, so the line runs straight
    const lineY = clamp(middleY, Math.max(y, ring.y) + 8, Math.min(y + height, ring.y + ring.height) - 8);
    const from = { x: side === "right" ? ring.x + ring.width : ring.x, y: clamp(lineY, ring.y + 6, ring.y + ring.height - 6) };
    return { side, x, y, from, to: { x: side === "right" ? x : x + width, y: clamp(lineY, y + 12, y + height - 12) } };
  };

  const fits = (place: CalloutPlace) => place.x >= minX && place.x <= maxX && place.y >= minY && place.y <= maxY;
  const order = prefer ? [prefer, ...ORDER.filter((side) => side !== prefer)] : ORDER;
  const found = order.map(candidate).find(fits);
  if (found) return found;

  const below = candidate("below");
  const y = Math.max(ring.y + ring.height + 4, Math.min(below.y, maxY));
  return { ...below, y, to: { x: below.to.x, y } };
}

/** The dock goes to the top of the window while the outline reaches down into its band */
export function dockOnTop(ring: Box | null, viewHeight: number, zone: number): boolean {
  return ring ? ring.y + ring.height > viewHeight - zone : false;
}

/** The dock's left edge: centred, or moved clear of an outline that reaches into its band from the side */
export function dockLeft(ring: Box | null, viewWidth: number, dockWidth: number, band: { top: number; bottom: number }): number {
  const centred = (viewWidth - dockWidth) / 2;
  if (!ring || ring.y >= band.bottom || ring.y + ring.height <= band.top) return centred;
  if (ring.x >= centred + dockWidth || ring.x + ring.width <= centred) return centred;
  const leftOfRing = ring.x - GAP - dockWidth;
  if (leftOfRing >= EDGE) return Math.min(centred, leftOfRing);
  const rightOfRing = ring.x + ring.width + GAP;
  if (rightOfRing + dockWidth <= viewWidth - EDGE) return Math.max(centred, rightOfRing);
  return centred;
}
