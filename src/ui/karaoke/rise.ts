import look from "./look.json";

export const RISE_CURVE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const RISE_EASING = `cubic-bezier(${RISE_CURVE.join(", ")})`;
export const RISE_MS = look.overlay.durationMs;

export function bezierY(t: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (low + high) / 2;
    if (at(x1, x2, mid) < t) low = mid;
    else high = mid;
  }
  return at(y1, y2, (low + high) / 2);
}
