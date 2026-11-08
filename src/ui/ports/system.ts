/** Main-process settings, the tray and the daemon's system routes, for the Settings screens. */
import type { UpdateView } from "@/shell/nuvoShell";

export type { UpdateView };

export async function trayAvailable(): Promise<boolean> {
  const status = await window.nuvoShell?.getTrayStatus().catch(() => null);
  return status?.available === true;
}

/** Null outside Electron or when main does not answer. */
export async function readCloseToTray(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? settings.closeToTray : null;
}

export async function writeCloseToTray(on: boolean): Promise<boolean> {
  const result = await window.nuvoShell?.setMainSetting("closeToTray", on).catch(() => null);
  return result?.ok === true;
}

/** Null where there is no entry to manage: not an AppImage, or a profile with moved folders. */
export async function readMenuEntry(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings?.menuEntryAvailable ? settings.menuEntry : null;
}

export async function writeMenuEntry(on: boolean): Promise<boolean> {
  const result = await window.nuvoShell?.setMainSetting("menuEntry", on).catch(() => null);
  return result?.ok === true;
}

/** Main's save dialog for a .csv or .txt `name`, then the text written there; false when cancelled or outside Electron. */
export async function saveTextFile(name: string, text: string): Promise<boolean> {
  return (await window.nuvoShell?.saveTextFile(name, text)) === true;
}

/** The browser, through main's window-open rule (http and https only). */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export const CORE_URL = "nuvo-core://local";

export type ProxyMode = "system" | "none" | "manual";

export interface ProxyView {
  mode: ProxyMode;
  url?: string;
  username?: string;
  /** Write only: main never hands the stored password back. */
  password?: string;
  /** Read only: the proxy in force, found by the automatic mode or set by hand; null for a direct connection. */
  inForce?: string | null;
}

export async function readProxy(): Promise<ProxyView | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? { mode: settings.proxy.mode, url: settings.proxy.url, username: settings.proxy.username, inForce: settings.proxyInForce ?? null } : null;
}

/** Main found a new proxy (a VPN app turned its proxy on) or the setting changed. */
export function onNetworkChanged(listener: () => void): () => void {
  return window.nuvoShell?.onNetworkChanged(listener) ?? (() => undefined);
}

/** Main validates the address (scheme, host, port, no credentials in the URL) and keeps the old value on refusal. */
export async function saveProxy(proxy: ProxyView): Promise<{ ok: boolean; error?: string }> {
  const result = await window.nuvoShell?.setMainSetting("proxy", proxy).catch(() => null);
  return result ?? { ok: false, error: "unavailable" };
}

/** One row of the daemon's check: `check` is dns, tcp, https, proxy, clock or tools. */
export interface NetCheckRow {
  check: string;
  host?: string;
  service?: string;
  ok: boolean;
  code?: string;
  ms: number;
  detail?: string;
}

export interface NetCheck {
  checkedAt: string;
  rows: NetCheckRow[];
  summary: string;
  code?: string;
  service?: string;
}

export interface ToolsView {
  tools: Array<{ name: string; status: "ok" | "outdated" | "missing" | "broken"; version?: string }>;
  download?: { tool: string; received: number; total?: number; failed: boolean };
}

export async function readTools(fetcher: typeof fetch = fetch): Promise<ToolsView | null> {
  const response = await fetcher(`${CORE_URL}/v1/system/deps`).catch(() => null);
  return response?.ok ? ((await response.json()) as ToolsView) : null;
}

/** What to tell about the tools, as locale keys with their values; empty when all is well. */
export function toolNotes(view: ToolsView): Array<{ key: string; vars?: Record<string, string | number> }> {
  const notes: Array<{ key: string; vars?: Record<string, string | number> }> = [];
  const { download } = view;
  if (download && !download.failed) {
    const percent = download.total ? Math.floor((download.received / download.total) * 100) : null;
    notes.push(
      percent === null
        ? { key: "ui.settings.tools.downloading", vars: { tool: download.tool } }
        : { key: "ui.settings.tools.progress", vars: { tool: download.tool, percent } },
    );
  }
  if (download?.failed) notes.push({ key: "ui.settings.tools.failed", vars: { tool: download.tool } });
  for (const tool of view.tools) {
    if (tool.status === "ok" || tool.name === "ffmpeg-pulse") continue;
    // yt-dlp looks after itself; a note would only repeat the download line.
    if (tool.name === download?.tool) continue;
    notes.push({ key: `ui.settings.tools.${tool.name === "js-runtime" ? "js_runtime" : tool.name === "ffmpeg" ? "ffmpeg" : "yt_dlp"}` });
  }
  return notes;
}

export async function runNetworkCheck(fetcher: typeof fetch = fetch): Promise<NetCheck> {
  const response = await fetcher(`${CORE_URL}/v1/system/network-check`, { method: "POST" });
  if (!response.ok) throw new Error(`network check answered ${response.status}`);
  return (await response.json()) as NetCheck;
}

/** The daemon's redacted report section; null when it does not answer. */
export async function systemReport(fetcher: typeof fetch = fetch): Promise<unknown | null> {
  const response = await fetcher(`${CORE_URL}/v1/system/report`).catch(() => null);
  return response?.ok ? ((await response.json()) as unknown) : null;
}

export async function appFacts(): Promise<{ version: string; platform: string; packaged: boolean; compositor: string } | null> {
  return (await window.nuvoShell?.getAppInfo().catch(() => null)) ?? null;
}

/** Null outside Electron or when main does not answer. */
export async function readUpdate(): Promise<UpdateView | null> {
  return (await window.nuvoShell?.getUpdateState().catch(() => null)) ?? null;
}

export function watchUpdate(onChange: (view: UpdateView) => void): () => void {
  return window.nuvoShell?.onUpdateState(onChange) ?? (() => undefined);
}

export async function installUpdate(): Promise<boolean> {
  return (await window.nuvoShell?.installUpdate().catch(() => false)) === true;
}

export async function openReleasePage(): Promise<boolean> {
  return (await window.nuvoShell?.openReleasePage().catch(() => false)) === true;
}

/** Null outside Electron or when main does not answer. */
export async function readDiscord(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? settings.discord.enabled : null;
}

export type DiscordState = "off" | "connecting" | "connected" | "no_client" | "error";

/** The presence connection as main sees it; null outside Electron or when main does not answer. */
export async function readDiscordStatus(): Promise<{ state: DiscordState; message?: string } | null> {
  return (await window.nuvoShell?.getDiscordStatus().catch(() => null)) ?? null;
}

export async function writeDiscord(enabled: boolean): Promise<boolean> {
  const result = await window.nuvoShell?.setMainSetting("discord", { enabled }).catch(() => null);
  return result?.ok === true;
}

export async function readAutoUpdate(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? settings.autoUpdate : null;
}

export async function writeAutoUpdate(on: boolean): Promise<boolean> {
  const result = await window.nuvoShell?.setMainSetting("autoUpdate", on).catch(() => null);
  return result?.ok === true;
}
