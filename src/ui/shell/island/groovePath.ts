export const GROOVE_HEIGHT = 100;

// one contour over the top and back under it; midpoints as knots keep it smooth at any width
export function groovePath(shape: readonly number[]): string {
  if (shape.length < 2) return "";
  const mid = GROOVE_HEIGHT / 2;
  const step = 1 / (shape.length - 1);
  const x = (index: number) => Math.round(index * step * 10_000) / 10;
  const y = (value: number, side: -1 | 1) => Math.round((mid + side * value * mid) * 10) / 10;
  const edge = (order: number[], side: -1 | 1) =>
    order
      .slice(1)
      .map((index, i) => {
        const before = order[i];
        return `Q${x(before)} ${y(shape[before], side)} ${(x(before) + x(index)) / 2} ${(y(shape[before], side) + y(shape[index], side)) / 2}`;
      })
      .join("");
  const forward = shape.map((_, index) => index);
  const last = shape.length - 1;
  return `M0 ${mid}L0 ${y(shape[0], -1)}${edge(forward, -1)}L1000 ${y(shape[last], -1)}L1000 ${y(shape[last], 1)}${edge([...forward].reverse(), 1)}L0 ${y(shape[0], 1)}Z`;
}
