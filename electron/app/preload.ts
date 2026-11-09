import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { NuvoShell } from "../../src/shell/nuvoShell";

const on =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const listener = (_event: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

const invoke = <T>(channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload) as Promise<T>;

const shell: NuvoShell = {
  minimize: () => invoke("win:minimize"),
  toggleMaximize: () => invoke("win:toggle-maximize"),
  toggleFullscreen: () => invoke("win:toggle-fullscreen"),
  close: () => invoke("win:close"),
  getWinState: () => invoke("win:get-state"),
  onWinState: on("win:state"),
  drag: (phase) => ipcRenderer.send("win:drag", { phase }),
  getAppInfo: () => invoke("app:info"),
  quit: () => invoke("app:quit"),
  onBeforeQuit: on("app:before-quit"),
  quitReady: () => ipcRenderer.send("app:quit-ready"),
  notify: (title, body) => invoke("app:notify", { title, body }),
  applyIcon: (pngDataUrl, { stock }) => invoke("icon:apply", { pngDataUrl, stock }),
  reveal: (path) => invoke("shell:reveal", { path }),
  saveTextFile: (name, text) => invoke("file:save-text", { name, text }),
  addMusicFolder: () => invoke("local:add-folder"),
  revealLocalTrack: (trackId) => invoke("local:reveal", { trackId }),
  // read here, not in the page: only a File the user picked or dropped has a path
  recognizeFile: async (file) => {
    const path = webUtils.getPathForFile(file);
    return path ? invoke("recognize:file", { path }) : null;
  },
  saveAsFiles: (request) => invoke("export:save-files", request),
  saveDocument: (request) => invoke("export:save-document", request),
  chromiumUsage: () => invoke("chromium:usage"),
  clearChromiumCache: () => invoke("chromium:clear", { scope: "http" }),
  systemMuted: () => invoke("sound:system-muted"),
  unmuteSystem: () => invoke("sound:unmute-system"),
  takePendingLink: () => invoke("link:take-pending"),
  onLink: on("link:open"),
  getCoreStatus: () => invoke("core:get-status"),
  onCoreStatus: on("core:status"),
  sendPlayerState: (state) => ipcRenderer.send("player:state", state),
  onRemoteCommand: on("player:command"),
  onNetworkChanged: on("network:changed"),
  onAppCommand: on("app:command"),
  getTrayStatus: () => invoke("tray:get-status"),
  getMainSettings: () => invoke("settings:main-get"),
  setMainSetting: (key, value) => invoke("settings:main-set", { key, value }),
  getDiscordStatus: () => invoke("discord:status"),
  getUpdateState: () => invoke("update:get-state"),
  onUpdateState: on("update:state"),
  installUpdate: () => invoke("update:install"),
  openReleasePage: () => invoke("update:open-release"),
  setGlobalShortcuts: (bindings) => invoke("shortcuts:set-global", bindings),
  notchUpdateLyrics: (lyrics) => ipcRenderer.send("notch:lyrics", lyrics),
  notchUpdateSettings: (settings) => ipcRenderer.send("notch:settings", settings),
  getPanelStatus: () => invoke("panel:get-status"),
  installPanelWidget: () => invoke("panel:install"),
  enablePanelWidget: () => invoke("panel:enable"),
  openExtensionsApp: () => invoke("panel:open-extensions"),
  youtubeCall: (op, args) => invoke("nuvo-yt:call", { op, args }),
  listSystemFonts: (rescan = false) => invoke("fonts:list-system", { rescan }),
  importFontFile: () => invoke("fonts:import-file"),
  deleteFontFile: (id) => invoke("fonts:delete", { id }),
  pickCoverImage: () => invoke("playlist:cover-pick"),
  exportTheme: (name, text) => invoke("theme:export", { name, text }),
  importThemeFile: () => invoke("theme:import"),
  appearanceReady: () => ipcRenderer.send("appearance:ready"),
  appearanceApplying: () => ipcRenderer.send("appearance:applying"),
};

contextBridge.exposeInMainWorld("nuvoShell", shell);
