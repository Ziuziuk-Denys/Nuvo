import { POCKET_MAX, POCKET_MIN, POCKET_SIZES, type PocketTop } from "../../src/pocket/contracts";
import type { Rect } from "../app/windowRules";
import type { NotchSession } from "../notch/session";

const EDGE_GAP = 24;
const MIN_VISIBLE = 80;

export interface PocketPlace {
  size: number;
  x?: number;
  y?: number;
}

export const clampSize = (size: number) => Math.min(POCKET_MAX, Math.max(POCKET_MIN, Math.round(size)));

// Linux gives a frameless window no shadow; the page draws one in this margin.
export const pocketMargin = (session: NotchSession) => (session === "windows" || session === "macos" ? 0 : 10);

export function pocketTop(session: NotchSession, heldByShell = false): PocketTop {
  if (session === "gnome-wayland") return heldByShell ? "app" : "window-menu";
  return session === "other-wayland" ? "none" : "app";
}

// A Wayland client never learns or sets its own position
export const remembersPlace = (session: NotchSession) => session === "x11" || session === "windows" || session === "macos";

export function validPlace(raw: unknown): PocketPlace | null {
  const place = raw as PocketPlace | null;
  if (!place || typeof place !== "object" || !Number.isFinite(place.size)) return null;
  const size = clampSize(place.size);
  return Number.isFinite(place.x) && Number.isFinite(place.y) ? { size, x: Math.round(place.x!), y: Math.round(place.y!) } : { size };
}

export function pocketBounds(place: PocketPlace | null, workAreas: Rect[], primary: Rect, margin: number): Rect {
  const size = place?.size ?? POCKET_SIZES.medium;
  const side = size + margin * 2;
  if (place?.x !== undefined && place.y !== undefined) {
    const { x, y } = place;
    const seen = workAreas.some(
      (area) =>
        Math.min(x + size, area.x + area.width) - Math.max(x, area.x) >= MIN_VISIBLE &&
        Math.min(y + size, area.y + area.height) - Math.max(y, area.y) >= MIN_VISIBLE,
    );
    if (seen) return { x: x - margin, y: y - margin, width: side, height: side };
  }
  return {
    x: Math.round(primary.x + primary.width - size - EDGE_GAP) - margin,
    y: Math.round(primary.y + primary.height - size - EDGE_GAP) - margin,
    width: side,
    height: side,
  };
}

export function kwinAboveScript(title: string, above: boolean): string {
  return `function pin(window) {
  if (window.caption !== ${JSON.stringify(title)}) return;
  window.keepAbove = ${above};
  window.onAllDesktops = ${above};
  window.skipTaskbar = true;
  window.skipPager = true;
  window.noBorder = true;
}
workspace.windowList().forEach(pin);
workspace.windowAdded.connect(pin);
`;
}
