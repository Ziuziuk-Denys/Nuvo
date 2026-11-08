/** Ctrl+Plus, Ctrl+Minus and Ctrl+0 zoom the main window in half steps (about 10 % each); the level is kept in main's settings. */

export const ZOOM_STEP = 0.5;
export const ZOOM_LIMIT = 3;

export type ZoomKey = "in" | "out" | "reset";

interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
}

/** The zoom a key press asks for: Ctrl (Cmd on macOS) with plus or equals, minus, or zero; null for anything else. */
export function zoomKey(input: KeyInput, mac = process.platform === "darwin"): ZoomKey | null {
  if (input.type !== "keyDown" || input.alt || !(mac ? input.meta : input.control)) return null;
  if (input.key === "+" || input.key === "=") return "in";
  if (input.key === "-" || input.key === "_") return "out";
  if (input.key === "0") return "reset";
  return null;
}

export function nextZoom(level: number, key: ZoomKey): number {
  if (key === "reset") return 0;
  return validZoom(level + (key === "in" ? ZOOM_STEP : -ZOOM_STEP));
}

/** A stored level read back: a finite number inside the limits, else 0. */
export function validZoom(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(ZOOM_LIMIT, Math.max(-ZOOM_LIMIT, raw));
}
