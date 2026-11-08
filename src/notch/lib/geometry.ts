export type IslandMode = "idle" | "live" | "hover" | "expanded";

export interface IslandSize {
  width: number;
  height: number;
  radius: number;
}

/** Body sizes; the concave wings add WING on each side. */
export const ISLAND_SIZES: Record<IslandMode, IslandSize> = {
  idle: { width: 200, height: 32, radius: 14 },
  live: { width: 272, height: 34, radius: 14 },
  hover: { width: 288, height: 44, radius: 16 },
  expanded: { width: 440, height: 184, radius: 32 },
};

export const WING = 14;
export const NOTCH_WINDOW = { width: 560, height: 240 };
const SHAPE_SLACK = 2;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Input region for the window: the painted island, wings included, centered at the top. */
export function islandRect(size: IslandSize, windowWidth = NOTCH_WINDOW.width): Rect {
  const width = Math.min(windowWidth, size.width + WING * 2 + SHAPE_SLACK * 2);
  return {
    x: Math.round((windowWidth - width) / 2),
    y: 0,
    width,
    height: size.height + SHAPE_SLACK,
  };
}

/**
 * Input region while growing. On Linux setShape also clips painting, so the rect leaves room for
 * the spring overshoot past the target size (`overshoot` is the spring peak minus 1).
 */
export function grownRect(from: IslandSize, to: IslandSize, overshoot: number, window = NOTCH_WINDOW): Rect {
  const exact = islandRect(to, window.width);
  const side = Math.ceil((Math.max(0, to.width - from.width) * overshoot) / 2);
  const below = Math.ceil(Math.max(0, to.height - from.height) * overshoot);
  const width = Math.min(window.width, exact.width + side * 2);
  return {
    x: Math.round((window.width - width) / 2),
    y: 0,
    width,
    height: Math.min(window.height, exact.height + below),
  };
}

const KAPPA = 0.5523;

/**
 * Dynamic-island silhouette: flat top flush with the screen edge, concave wings at both top
 * corners, rounded bottom. One path for every size, so a size morph stays one shape.
 */
export function islandPath({ width, height, radius }: IslandSize, wing = WING): string {
  const total = width + wing * 2;
  const r = Math.min(radius, Math.max(0, height - wing), width / 2);
  const left = wing;
  const right = wing + width;
  const k = r * KAPPA;
  const n = (v: number) => Math.round(v * 100) / 100;
  return [
    `M0 0`,
    `H${n(total)}`,
    `Q${n(right)} 0 ${n(right)} ${n(wing)}`,
    `V${n(height - r)}`,
    `C${n(right)} ${n(height - r + k)} ${n(right - r + k)} ${n(height)} ${n(right - r)} ${n(height)}`,
    `H${n(left + r)}`,
    `C${n(left + r - k)} ${n(height)} ${n(left)} ${n(height - r + k)} ${n(left)} ${n(height - r)}`,
    `V${n(wing)}`,
    `Q${n(left)} 0 0 0`,
    `Z`,
  ].join(" ");
}
