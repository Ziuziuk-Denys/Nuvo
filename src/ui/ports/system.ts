import type { UpdateView } from "@/shell/nuvoShell";

export type { UpdateView };

export async function trayAvailable(): Promise<boolean> {
  const status = await window.nuvoShell?.getTrayStatus().catch(() => null);
  return status?.available === true;
}

export async function readCloseToTray(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? settings.keepInTray : null;
}

export async function writeCloseToTray(on: boolean): Promise<boolean> {
  const result = await window.nuvoShell?.setMainSetting("keepInTray", on).catch(() => null);
  return result?.ok === true;
}

export async function readMenuEntry(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings?.menuEntryAvailable ? settings.menuEntry : null;
}

export async function writeMenuEntry(on: boolean): Promise<boolean> {
  const result = await window.nuvoShell?.setMainSetting("menuEntry", on).catch(() => null);
  return result?.ok === true;
}

export async function saveTextFile(name: string, text: string): Promise<boolean> {
  return (await window.nuvoShell?.saveTextFile(name, text)) === true;
}

// Opens through main's window-open rule, which allows http and https only
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
  inForce?: string | null;
}

export async function readProxy(): Promise<ProxyView | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? { mode: settings.proxy.mode, url: settings.proxy.url, username: settings.proxy.username, inForce: settings.proxyInForce ?? null } : null;
}

export function onNetworkChanged(listener: () => void): () => void {
  return window.nuvoShell?.onNetworkChanged(listener) ?? (() => undefined);
}

/** Main validates the address (scheme, host, port, no credentials in the URL) and keeps the old value on refusal. */
export async function saveProxy(proxy: ProxyView): Promise<{ ok: boolean; error?: string }> {
  const result = await window.nuvoShell?.setMainSetting("proxy", proxy).catch(() => null);
  return result ?? { ok: false, error: "unavailable" };
}

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

export type ToolRowName = "yt-dlp" | "js-runtime" | "ffmpeg";
export type ToolStatus = "ok" | "outdated" | "missing" | "broken";

export interface ToolsView {
  tools: Array<{ name: string; status: ToolStatus; version?: string }>;
  download?: { tool: string; received: number; total?: number; failed: boolean };
}

export const TOOL_ROWS: readonly ToolRowName[] = ["yt-dlp", "js-runtime", "ffmpeg"];

/** The program a Settings row downloads; a download names the program. */
export const ROW_PROGRAM: Record<ToolRowName, string> = { "yt-dlp": "yt-dlp", "js-runtime": "deno", ffmpeg: "ffmpeg" };

export function programLabel(program: string): string {
  if (program === "deno") return "Deno";
  if (program.startsWith("whisper-")) return "Whisper";
  return program === "ffmpeg" ? "ffmpeg" : "yt-dlp";
}

export async function readTools(fetcher: typeof fetch = fetch): Promise<ToolsView | null> {
  const response = await fetcher(`${CORE_URL}/v1/system/deps`).catch(() => null);
  return response?.ok ? ((await response.json()) as ToolsView) : null;
}

export async function downloadTool(name: ToolRowName, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`${CORE_URL}/v1/system/tools/${name}/download`, { method: "POST" }).catch(() => null);
  return response?.ok === true;
}

export async function runNetworkCheck(fetcher: typeof fetch = fetch): Promise<NetCheck> {
  const response = await fetcher(`${CORE_URL}/v1/system/network-check`, { method: "POST" });
  if (!response.ok) throw new Error(`network check answered ${response.status}`);
  return (await response.json()) as NetCheck;
}

export async function systemReport(fetcher: typeof fetch = fetch): Promise<unknown | null> {
  const response = await fetcher(`${CORE_URL}/v1/system/report`).catch(() => null);
  return response?.ok ? ((await response.json()) as unknown) : null;
}

export async function appFacts(): Promise<{ version: string; platform: string; packaged: boolean; compositor: string } | null> {
  return (await window.nuvoShell?.getAppInfo().catch(() => null)) ?? null;
}

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

export async function readDiscord(): Promise<boolean | null> {
  const settings = await window.nuvoShell?.getMainSettings().catch(() => null);
  return settings ? settings.discord.enabled : null;
}

export type DiscordState = "off" | "connecting" | "connected" | "no_client" | "error";

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
