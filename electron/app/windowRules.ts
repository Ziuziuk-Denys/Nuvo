export const DEFAULT_SIZE = { width: 1200, height: 780 };
export const MIN_SIZE = { width: 1100, height: 705 };

export type CloseDecision = "close" | "hide" | "quit";

const MIN_VISIBLE_PX = 80;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function onScreenBounds(bounds: Rect, workAreas: Rect[]): Rect {
  if (workAreas.length === 0) return bounds;
  const overlap = (area: Rect) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return width > 0 && height > 0 ? width * height : 0;
  };
  // The title bar has to be reachable: a corner a few pixels on screen does not count.
  const reachable = workAreas.some(
    (area) =>
      overlap(area) >= Math.min(MIN_VISIBLE_PX * MIN_VISIBLE_PX, bounds.width * bounds.height) && bounds.y >= area.y - 1 && bounds.y < area.y + area.height,
  );
  if (reachable) return bounds;
  const distance = (area: Rect) =>
    Math.hypot(area.x + area.width / 2 - (bounds.x + bounds.width / 2), area.y + area.height / 2 - (bounds.y + bounds.height / 2));
  const area = workAreas.reduce((best, next) => (distance(next) < distance(best) ? next : best));
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}

export function closeDecision(input: { quitting: boolean; keepInTray: boolean; trayAvailable: boolean }): CloseDecision {
  if (input.quitting) return "close";
  return input.keepInTray && input.trayAvailable ? "hide" : "quit";
}

export function minimizeAllowed(input: { fullscreen: boolean; tiling: boolean }): boolean {
  return !input.fullscreen && !input.tiling;
}

export function toggleMaximizeAction(input: { fullscreen: boolean; maximized: boolean }): "leave-fullscreen" | "restore" | "maximize" {
  if (input.fullscreen) return "leave-fullscreen";
  return input.maximized ? "restore" : "maximize";
}

export interface WinState {
  maximized: boolean;
  fullscreen: boolean;
  visible: boolean;
}

export function activateWindow(win: { visible: boolean; focused: boolean; minimized: boolean }, canHide: boolean): "show" | "hide" | "focus" {
  if (!win.visible || win.minimized) return "show";
  if (win.focused) return canHide ? "hide" : "focus";
  return "focus";
}

const isWeb = (url: string) => /^https?:\/\//i.test(url);

export function windowOpenDecision(url: string): "browser" | "deny" {
  return isWeb(url) ? "browser" : "deny";
}

export function navigationDecision(url: string, devServerUrl: string | undefined, appFileUrl: string): "allow" | "browser" | "deny" {
  if (devServerUrl) {
    try {
      if (new URL(url).origin === new URL(devServerUrl).origin) return "allow";
    } catch {
      return "deny";
    }
  }
  if (url.startsWith("file://") && url.split("#")[0].split("?")[0] === appFileUrl.split("#")[0]) return "allow";
  return isWeb(url) ? "browser" : "deny";
}

export function chromiumSwitches(nativeWayland: boolean): Array<[string, string?]> {
  return [
    ["enable-gpu-rasterization"],
    ["disable-http2"],
    ["enable-features", ["NetworkServiceInProcess2", ...(nativeWayland ? ["GlobalShortcutsPortal"] : [])].join(",")],
    ["disable-features", "AudioServiceOutOfProcess"],
  ];
}

export function relaunchArgs(argv: readonly string[]): string[] {
  return argv.slice(1).filter((arg) => !arg.startsWith("--inspect"));
}
