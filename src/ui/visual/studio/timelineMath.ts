export type Range = [number, number];

export interface RangeLimits {
  min: number;
  max: number;
  total: number;
}

const FOLLOW_EDGE = 0.95;
const FOLLOW_LEAD = 0.1;

export function clampView(viewFrom: number, view: number, total: number): number {
  return Math.max(0, Math.min(viewFrom, total - view));
}

export function zoomAround(viewFrom: number, view: number, total: number, anchorMs: number, nextView: number): number {
  const ratio = (anchorMs - viewFrom) / view;
  return clampView(anchorMs - ratio * nextView, nextView, total);
}

export function follow(viewFrom: number, view: number, atMs: number, total: number): number {
  if (atMs >= viewFrom && atMs <= viewFrom + view * FOLLOW_EDGE) return viewFrom;
  return clampView(atMs - view * FOLLOW_LEAD, view, total);
}

export function moveRange([from, to]: Range, deltaMs: number, limits: RangeLimits): Range {
  const length = to - from;
  const start = Math.max(0, Math.min(from + deltaMs, limits.total - length));
  return [start, start + length];
}

export function resizeRange([from, to]: Range, edge: "from" | "to", atMs: number, limits: RangeLimits): Range {
  if (edge === "from") return [Math.max(0, to - limits.max, Math.min(atMs, to - limits.min)), to];
  return [from, Math.min(from + limits.max, limits.total, Math.max(atMs, from + limits.min))];
}
