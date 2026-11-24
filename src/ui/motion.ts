// motion.css mirrors these values; foundations.test.ts keeps them in step

export const EASE = {
  out: [0.2, 0.8, 0.2, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.4, 0, 1, 1],
} as const;

// critically damped: settles without overshoot, and WAAPI and CSS take the same curve
export const SPRING = "linear(0, 0.094, 0.274, 0.456, 0.609, 0.727, 0.814, 0.875, 0.918, 0.947, 0.966, 0.979, 0.987, 0.993, 0.996, 0.999, 1)";
export const LAYOUT_SPRING = { type: "spring", bounce: 0, visualDuration: 0.22 } as const;

export const DURATION_MS = {
  instant: 80,
  quick: 140,
  base: 220,
  page: 360,
  entrance: 480,
  light: 500,
} as const;

export const STAGGER_MS = 36;
export const MAX_STAGGERED = 6;
export const ENTRANCE_RISE_PX = 10;
export const ENTRANCE_SCALE = 0.98;
export const PAGE_RISE_PX = 12;
export const PRESS_SCALE = 0.95;
export const PRESS_WIDE_SCALE = 0.98;
export const POPOVER_SCALE = 0.97;
export const POPOVER_SHIFT_PX = 4;
export const DRAG_LIFT_SCALE = 1.02;
export const DRIFT_PERIOD_MS = 24_000;
export const SCROLLBAR_FADE_MS = 800;
export const SLOW_DATA_MS = 400;

export function entranceDelayMs(index: number): number {
  return Math.min(Math.max(index, 0), MAX_STAGGERED - 1) * STAGGER_MS;
}

/** framer-motion wants seconds. */
export function seconds(ms: number): number {
  return ms / 1000;
}
