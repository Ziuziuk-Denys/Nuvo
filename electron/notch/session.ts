import type { NotchEdge } from "../../src/notch/contracts";

export type NotchSession = "gnome-wayland" | "kde-wayland" | "hyprland" | "sway" | "x11" | "other-wayland" | "windows" | "macos";
export type NotchMode = "auto" | "on" | "off";

type Env = Record<string, string | undefined>;

export function detectNotchSession(env: Env, ozoneX11 = false, platform: NodeJS.Platform = "linux"): NotchSession {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toUpperCase();
  if (ozoneX11 || env.XDG_SESSION_TYPE === "x11") return "x11";
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return "hyprland";
  if (env.SWAYSOCK) return "sway";
  if (desktop.includes("KDE")) return "kde-wayland";
  if (desktop.includes("GNOME")) return "gnome-wayland";
  return "other-wayland";
}

export function canPlaceNotch(session: NotchSession): boolean {
  return session !== "gnome-wayland" && session !== "other-wayland";
}

export function notchEnabled(mode: NotchMode, session: NotchSession): boolean {
  if (mode === "off") return false;
  return canPlaceNotch(session);
}

// Layer-shell bars draw over every window on Hyprland and Sway, so the Notch goes below them there
export function resolveEdge(edge: NotchEdge, session: NotchSession): "screen" | "bar" {
  if (edge !== "auto") return edge;
  return session === "hyprland" || session === "sway" ? "bar" : "screen";
}

// Windows and macOS have no input shape; the window ignores the mouse until the pointer is on the pill
export function clicksPassThrough(session: NotchSession): boolean {
  return session === "windows" || session === "macos";
}
