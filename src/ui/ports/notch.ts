export { useNotchSettingsStore } from "@/features/notch/store/notchSettingsStore";

export interface NotchSession {
  session: string;
  supported: boolean;
  placementError?: string | null;
  /** The desktop panel widget that fits this session; null where there is none. */
  panel?: { target: "gnome" | "plasma" | "waybar"; available: boolean; manual?: boolean; source?: string; pendingEnable?: boolean } | null;
}

export type PanelInstallResult = { ok: true; next: "ready" | "relogin" | "add-widget" | "add-module"; snippet?: string } | { ok: false; error: string };

/** The compositor session the Notch runs in; null outside Electron or when the main process does not answer. */
export function getNotchSession(): Promise<NotchSession | null> {
  return window.nuvoElectron?.getNotchSession?.().catch(() => null) ?? Promise.resolve(null);
}

/** Installs the panel widget for this desktop. Only from a click: it runs the desktop's install tool. */
export function installPanelWidget(): Promise<PanelInstallResult> {
  return window.nuvoElectron?.installPanelWidget?.() ?? Promise.resolve({ ok: false, error: "unsupported" });
}

/** GNOME's Turn on after the login that follows an install. Only from a click. */
export function enablePanelWidget(): Promise<PanelInstallResult> {
  return window.nuvoElectron?.enablePanelWidget?.() ?? Promise.resolve({ ok: false, error: "unsupported" });
}

/** Opens GNOME's Extensions app. Only from a click. */
export function openExtensionsApp(): Promise<boolean> {
  return window.nuvoElectron?.openExtensionsApp?.() ?? Promise.resolve(false);
}
