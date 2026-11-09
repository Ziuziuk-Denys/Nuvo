// motion.css mirrors these values; foundations.test.ts keeps them in step

export const EASE = {
  out: [0.2, 0.7, 0.2, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.4, 0, 1, 1],
} as const;

export const DURATION_MS = {
  instant: 90,
  quick: 160,
  base: 240,
  page: 420,
  entrance: 560,
  light: 900,
} as const;

export const STAGGER_MS = 60;
export const MAX_STAGGERED = 6;
export const ENTRANCE_RISE_PX = 16;
export const ENTRANCE_SCALE = 0.98;
export const PAGE_RISE_PX = 12;
export const PRESS_SCALE = 0.97;
export const POPOVER_SCALE = 0.96;
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
