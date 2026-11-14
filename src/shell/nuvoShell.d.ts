import type { RemoteCommand, SurfaceState } from "../engine/types";
import type { NotchLyrics, NotchSettings } from "../notch/contracts";

export type CoreStatus = "starting" | "ready" | "restarting" | "failed";
export interface WinState {
  maximized: boolean;
  fullscreen: boolean;
  visible: boolean;
}
export interface AppInfo {
  version: string;
  platform: string;
  packaged: boolean;
  compositor: "hyprland" | "sway" | "wayland" | "none";
  tiling: boolean;
}
export interface PanelStatus {
  session: string;
  supported: boolean;
  placementError: string | null;
  panel: PanelInfo | null;
}
export interface PanelInfo {
  target: "gnome" | "plasma" | "waybar";
  available: boolean;
  manual: boolean;
  source: string;
  pendingEnable: boolean;
}
export type PanelInstallResult =
  | { ok: true; next: "ready" | "relogin" | "add-widget" | "add-module"; snippet?: string }
  | { ok: false; error: "missing-files" | "missing-tool" | "unsupported" | string };
export interface DeeplinkTarget {
  type: "artist" | "album" | "playlist" | "track" | "share";
  id: string;
}
export interface MainSettingsView {
  keepInTray: boolean;
  trayHintShown: boolean;
  trackChangeNotice: boolean;
  autoUpdate: boolean;
  menuEntry: boolean;
  menuEntryAvailable?: boolean;
  discord: { enabled: boolean };
  proxy: { mode: "system" | "none" | "manual"; url?: string; username?: string; hasPassword: boolean; passwordStorable: boolean };
  appearance: { safe: boolean; failedStarts: number };
  proxyInForce?: string | null;
}
export interface UpdateView {
  phase: "off" | "idle" | "downloading" | "ready" | "available";
  mode: "install" | "notify" | "off";
  version?: string;
  percent?: number;
}
export interface FontFileEntry {
  id: string;
  family: string;
  format: "ttf" | "otf" | "woff2";
  bytes: number;
  addedAt: number;
}
export type WallpaperImportError = "too_large" | "empty" | "format" | "read" | "write";
export type FontImportError = "cancelled" | "too_large" | "empty" | "format" | "woff1" | "collection" | "damaged" | "limit" | "write";
export interface ChromiumUsage {
  httpCacheBytes: number;
  codeCacheBytes: number;
  localStorageBytes: number;
  indexedDbBytes: number;
  serviceWorkerBytes: number;
  blobBytes: number;
  path: string;
}
type Off = () => void;

export interface SaveFilesRequest {
  trackIds?: string[];
  playlistId?: string;
  liked?: boolean;
  label: string;
  format: "original" | "mp3";
  playlistFile: boolean;
}

export type SaveDocumentRequest =
  | { kind: "playlist"; id: string; title: string; format: "m3u8" | "csv" | "json" }
  | { kind: "library"; format: "json" | "csv" }
  | { kind: "stats"; format: "json" | "csv"; from?: string; to?: string };

export type AddFolderResult = { root: { id: number; path: string } } | { error: string } | null;

export interface NuvoShell {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  close(): Promise<void>;
  getWinState(): Promise<WinState>;
  onWinState(cb: (state: WinState) => void): Off;
  getAppInfo(): Promise<AppInfo>;
  notify(title: string, body: string): Promise<boolean>;
  quit(): Promise<void>;
  onBeforeQuit(cb: (info: { deadlineMs: number }) => void): Off;
  quitReady(): void;
  applyIcon(pngDataUrl: string, options: { stock: boolean }): Promise<void>;
  reveal(path: string): Promise<boolean>;
  saveTextFile(name: string, text: string): Promise<boolean>;
  chromiumUsage(): Promise<ChromiumUsage>;
  clearChromiumCache(): Promise<boolean>;
  systemMuted(): Promise<boolean | null>;
  unmuteSystem(): Promise<void>;
  takePendingLink(): Promise<DeeplinkTarget | null>;
  onLink(cb: (target: DeeplinkTarget) => void): Off;
  getCoreStatus(): Promise<CoreStatus>;
  onCoreStatus(cb: (status: CoreStatus) => void): Off;
  sendPlayerState(state: SurfaceState): void;
  onRemoteCommand(cb: (command: RemoteCommand) => void): Off;
  onNetworkChanged(cb: () => void): Off;
  onAppCommand(cb: (command: { commandId: string }) => void): Off;
  getTrayStatus(): Promise<{ available: boolean; keepInTray: boolean }>;
  getMainSettings(): Promise<MainSettingsView>;
  setMainSetting(key: string, value: unknown): Promise<{ ok: boolean; error?: string }>;
  getDiscordStatus(): Promise<{ state: "off" | "connecting" | "connected" | "no_client" | "error"; message?: string }>;
  getUpdateState(): Promise<UpdateView>;
  onUpdateState(cb: (view: UpdateView) => void): Off;
  installUpdate(): Promise<boolean>;
  openReleasePage(): Promise<boolean>;
  setGlobalShortcuts(bindings: Array<{ commandId: string; accelerator: string }>): Promise<Array<{ commandId: string; ok: boolean; reason?: string }>>;
  notchUpdateLyrics(lyrics: NotchLyrics): void;
  notchUpdateSettings(settings: NotchSettings): void;
  getPanelStatus(): Promise<PanelStatus>;
  installPanelWidget(): Promise<PanelInstallResult>;
  enablePanelWidget(): Promise<PanelInstallResult>;
  openExtensionsApp(): Promise<boolean>;
  youtubeCall(op: "content-token" | "tv-identity" | "player-transform" | "ready", args: unknown): Promise<unknown>;
  listSystemFonts(rescan?: boolean): Promise<{ ok: true; families: string[] } | { ok: false }>;
  /** Main's open dialog, checks and hash-named copy; the renderer never supplies a path. */
  importFontFile(): Promise<{ ok: true; file: FontFileEntry } | { ok: false; error: FontImportError }>;
  deleteFontFile(id: string): Promise<boolean>;
  /** Main keeps its own copy; the page gets its name, never a path. */
  importWallpaper(file: File): Promise<{ ok: true; name: string } | { ok: false; error: WallpaperImportError }>;
  clearWallpaper(): Promise<void>;
  pickCoverImage(): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: "cancelled" | "too_large" | "format" | "damaged" }>;
  exportTheme(name: string, text: string): Promise<boolean | "failed">;
  importThemeFile(): Promise<{ ok: true; text: string } | { ok: false; error: "cancelled" | "theme_size" | "theme_encoding" | "theme_css" }>;
  addMusicFolder(): Promise<AddFolderResult>;
  revealLocalTrack(trackId: string): Promise<boolean>;
  recognizeFile(file: File): Promise<{ id: string } | null>;
  saveAsFiles(request: SaveFilesRequest): Promise<{ jobId: string } | { error: string } | null>;
  saveDocument(request: SaveDocumentRequest): Promise<{ path: string } | { error: string } | null>;
  appearanceReady(): void;
  appearanceApplying(): void;
}

declare global {
  interface Window {
    nuvoShell?: NuvoShell;
  }
}
