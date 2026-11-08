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
/** The Notch's session and the desktop panel widget that fits it (Linux only). */
export interface PanelStatus {
  session: string;
  supported: boolean;
  placementError: string | null;
  panel: PanelInfo | null;
}
/** `manual`: the profile's folders are moved, so the UI shows steps instead of the one-click install. */
export interface PanelInfo {
  target: "gnome" | "plasma" | "waybar";
  available: boolean;
  manual: boolean;
  /** Where this build keeps the widget's files, for the manual steps. */
  source: string;
  /** GNOME: installed, waiting for Turn on after the next login. */
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
  closeToTray: boolean;
  trayHintShown: boolean;
  trackChangeNotice: boolean;
  autoUpdate: boolean;
  /** AppImage only: Nuvo's own entry in the applications menu. */
  menuEntry: boolean;
  /** Whether this run can write that entry: a packaged AppImage on the real profile. */
  menuEntryAvailable?: boolean;
  discord: { enabled: boolean };
  proxy: { mode: "system" | "none" | "manual"; url?: string; username?: string; hasPassword: boolean; passwordStorable: boolean };
  appearance: { safe: boolean; failedStarts: number };
  /** The proxy every request takes now, without its login; null for a direct connection. */
  proxyInForce?: string | null;
}
/** Auto-update state from main. `off`: disabled by the switch or unavailable here (a development run). */
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

/** Save tracks as files: ids and choices only; main asks for the folder in its own dialog. */
export interface SaveFilesRequest {
  trackIds?: string[];
  playlistId?: string;
  liked?: boolean;
  label: string;
  format: "original" | "mp3";
  playlistFile: boolean;
}

/** Export a playlist or the library as a document; main asks where to put it. */
export type SaveDocumentRequest =
  | { kind: "playlist"; id: string; title: string; format: "m3u8" | "csv" | "json" }
  | { kind: "library"; format: "json" | "csv" }
  | { kind: "stats"; format: "json" | "csv"; from?: string; to?: string };

export type AddFolderResult = { root: { id: number; path: string } } | { error: string } | null;

/** `window.nuvoShell`: the only object the main window's preload exposes. */
export interface NuvoShell {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  close(): Promise<void>;
  getWinState(): Promise<WinState>;
  onWinState(cb: (state: WinState) => void): Off;
  drag(phase: "start" | "move" | "end"): void;
  getAppInfo(): Promise<AppInfo>;
  /** A system notification, shown only while the window is not focused; true when it was shown. */
  notify(title: string, body: string): Promise<boolean>;
  quit(): Promise<void>;
  onBeforeQuit(cb: (info: { deadlineMs: number }) => void): Off;
  quitReady(): void;
  applyIcon(pngDataUrl: string, options: { stock: boolean }): Promise<void>;
  reveal(path: string): Promise<boolean>;
  /** Opens a save dialog for `name` (a .csv or .txt base name) and writes `text`; false when cancelled. */
  saveTextFile(name: string, text: string): Promise<boolean>;
  chromiumUsage(): Promise<ChromiumUsage>;
  clearChromiumCache(): Promise<boolean>;
  /** Linux: true when the system mixer holds Nuvo's playback muted; null when it cannot tell. */
  systemMuted(): Promise<boolean | null>;
  unmuteSystem(): Promise<void>;
  takePendingLink(): Promise<DeeplinkTarget | null>;
  onLink(cb: (target: DeeplinkTarget) => void): Off;
  getCoreStatus(): Promise<CoreStatus>;
  onCoreStatus(cb: (status: CoreStatus) => void): Off;
  sendPlayerState(state: SurfaceState): void;
  onRemoteCommand(cb: (command: RemoteCommand) => void): Off;
  /** The proxy in force changed; a new way out, so what failed may work now. */
  onNetworkChanged(cb: () => void): Off;
  onAppCommand(cb: (command: { commandId: string }) => void): Off;
  getTrayStatus(): Promise<{ available: boolean; closeToTray: boolean }>;
  getMainSettings(): Promise<MainSettingsView>;
  setMainSetting(key: string, value: unknown): Promise<{ ok: boolean; error?: string }>;
  getDiscordStatus(): Promise<{ state: "off" | "connecting" | "connected" | "no_client" | "error"; message?: string }>;
  getUpdateState(): Promise<UpdateView>;
  onUpdateState(cb: (view: UpdateView) => void): Off;
  /** Restarts into the downloaded version; false when none is ready. Only ever called by the user's click. */
  installUpdate(): Promise<boolean>;
  /** Opens the release page in the browser (builds that cannot update themselves). */
  openReleasePage(): Promise<boolean>;
  setGlobalShortcuts(bindings: Array<{ commandId: string; accelerator: string }>): Promise<Array<{ commandId: string; ok: boolean; reason?: string }>>;
  notchUpdateLyrics(lyrics: NotchLyrics): void;
  notchUpdateSettings(settings: NotchSettings): void;
  getPanelStatus(): Promise<PanelStatus>;
  /** Installs the panel widget for this desktop; only ever called by the user's click. */
  installPanelWidget(): Promise<PanelInstallResult>;
  /** GNOME's Turn on after a login: `gnome-extensions enable` only. */
  enablePanelWidget(): Promise<PanelInstallResult>;
  /** Opens GNOME's Extensions app; false when it could not start. */
  openExtensionsApp(): Promise<boolean>;
  /** The YouTube worker (`nuvo-yt:call`); answers or rejects with a `worker-*` or `bad-input` code. */
  youtubeCall(op: "content-token" | "tv-identity" | "player-transform" | "ready", args: unknown): Promise<unknown>;
  /** Installed families from fc-list in main; no file paths. `rescan` drops the cached list. */
  listSystemFonts(rescan?: boolean): Promise<{ ok: true; families: string[] } | { ok: false }>;
  /** Main's open dialog, checks and hash-named copy; the renderer never supplies a path. */
  importFontFile(): Promise<{ ok: true; file: FontFileEntry } | { ok: false; error: FontImportError }>;
  deleteFontFile(id: string): Promise<boolean>;
  /** Main's open dialog for a playlist cover: the image bytes and type, never a path. */
  pickCoverImage(): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: "cancelled" | "too_large" | "format" | "damaged" }>;
  /** Main's save dialog for `<name>.nuvotheme.json`: true saved, false cancelled or another dialog open, "failed" when the file could not be written. */
  exportTheme(name: string, text: string): Promise<boolean | "failed">;
  importThemeFile(): Promise<{ ok: true; text: string } | { ok: false; error: "cancelled" | "theme_size" | "theme_encoding" | "theme_css" }>;
  /** Main's folder dialog, then the daemon scans it. `null`: the user closed the dialog. */
  addMusicFolder(): Promise<AddFolderResult>;
  /** Shows a local track in the file manager; false when it is gone. */
  revealLocalTrack(trackId: string): Promise<boolean>;
  /** Lets the daemon read a file the user picked or dropped; the id stands for it in a recognize job. `null`: it has no path, or the daemon refused. */
  recognizeFile(file: File): Promise<{ id: string } | null>;
  /** Main's folder dialog, then a save job starts. `null`: the user closed the dialog. */
  saveAsFiles(request: SaveFilesRequest): Promise<{ jobId: string } | { error: string } | null>;
  /** Main's save dialog, then the document is written. `null`: the user closed the dialog. */
  saveDocument(request: SaveDocumentRequest): Promise<{ path: string } | { error: string } | null>;
  /** The look is applied: this start did not crash (appearance safe mode). */
  appearanceReady(): void;
  /** The saved look was read and is being applied; main treats silence after this as a hang. */
  appearanceApplying(): void;
}

declare global {
  interface Window {
    nuvoShell?: NuvoShell;
  }
}
