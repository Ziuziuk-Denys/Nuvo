export { useNotchSettingsStore } from "@/features/notch/store/notchSettingsStore";

export interface NotchSession {
  session: string;
  supported: boolean;
  placementError?: string | null;
  panel?: { target: "gnome" | "plasma" | "waybar"; available: boolean; manual?: boolean; source?: string; pendingEnable?: boolean } | null;
}

export type PanelInstallResult = { ok: true; next: "ready" | "relogin" | "add-widget" | "add-module"; snippet?: string } | { ok: false; error: string };

export function getNotchSession(): Promise<NotchSession | null> {
  return window.nuvoElectron?.getNotchSession?.().catch(() => null) ?? Promise.resolve(null);
}

// Only call from a click: it runs the desktop's install tool
export function installPanelWidget(): Promise<PanelInstallResult> {
  return window.nuvoElectron?.installPanelWidget?.() ?? Promise.resolve({ ok: false, error: "unsupported" });
}

// Only call from a click
export function enablePanelWidget(): Promise<PanelInstallResult> {
  return window.nuvoElectron?.enablePanelWidget?.() ?? Promise.resolve({ ok: false, error: "unsupported" });
}

// Only call from a click
export function openExtensionsApp(): Promise<boolean> {
  return window.nuvoElectron?.openExtensionsApp?.() ?? Promise.resolve(false);
}
