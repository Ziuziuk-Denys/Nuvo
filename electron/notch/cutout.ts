import type { Cutout } from "../../src/notch/contracts";
import type { DisplayBounds } from "./placement";

export interface MacScreen {
  frame: DisplayBounds;
  left: DisplayBounds | null;
  right: DisplayBounds | null;
}

// JXA: Electron has no API for the camera housing; NSScreen reports it as the space between the two top auxiliary areas (macOS 12+)
export const SCREENS_SCRIPT = `ObjC.import("AppKit");
const rect = (r) => ({ x: r.origin.x, y: r.origin.y, width: r.size.width, height: r.size.height });
const area = (s, name) => {
  try {
    const r = s[name];
    return r && r.size ? rect(r) : null;
  } catch (error) {
    return null;
  }
};
const list = $.NSScreen.screens;
const out = [];
for (let i = 0; i < list.count; i++) {
  const s = list.objectAtIndex(i);
  out.push({ frame: rect(s.frame), left: area(s, "auxiliaryTopLeftArea"), right: area(s, "auxiliaryTopRightArea") });
}
JSON.stringify(out);`;

const isRect = (value: unknown): value is DisplayBounds =>
  Boolean(value) && ["x", "y", "width", "height"].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

export function parseScreens(text: string): MacScreen[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => isRect(item?.frame))
      .map((item) => ({ frame: item.frame, left: isRect(item.left) ? item.left : null, right: isRect(item.right) ? item.right : null }));
  } catch {
    return [];
  }
}

// NSScreen frames grow upward from the bottom of the first screen; Electron bounds grow downward from its top
export function cutoutFor(screens: MacScreen[], display: DisplayBounds): Cutout | null {
  const base = screens[0]?.frame;
  if (!base) return null;
  const screen = screens.find(
    ({ frame }) =>
      frame.x === display.x &&
      frame.width === display.width &&
      frame.height === display.height &&
      base.y + base.height - (frame.y + frame.height) === display.y,
  );
  if (!screen?.left || !screen.right || screen.left.width <= 0 || screen.right.width <= 0) return null;
  const width = screen.frame.width - screen.left.width - screen.right.width;
  const height = Math.min(screen.left.height, screen.right.height);
  return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
}
