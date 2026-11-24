import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { NuvoShell, WallpaperImport } from "../../src/shell/nuvoShell";

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

async function importFile(channel: string, file: File): Promise<WallpaperImport> {
  const path = webUtils.getPathForFile(file);
  return path ? invoke(channel, { path }) : { ok: false, error: "read" };
}

const shell: NuvoShell = {
  minimize: () => invoke("win:minimize"),
  toggleMaximize: () => invoke("win:toggle-maximize"),
  toggleFullscreen: () => invoke("win:toggle-fullscreen"),
  close: () => invoke("win:close"),
  getWinState: () => invoke("win:get-state"),
  onWinState: on("win:state"),
  getAppInfo: () => invoke("app:info"),
  quit: () => invoke("app:quit"),
  onBeforeQuit: on("app:before-quit"),
  quitReady: () => ipcRenderer.send("app:quit-ready"),
  notify: (title, body) => invoke("app:notify", { title, body }),
  applyIcon: (pngDataUrl, { stock, flat }) => invoke("icon:apply", { pngDataUrl, stock, flat }),
  reveal: (path) => invoke("shell:reveal", { path }),
  saveTextFile: (name, text) => invoke("file:save-text", { name, text }),
  addMusicFolder: () => invoke("local:add-folder"),
  addMusicFiles: (files) => {
    if (!files) return invoke("local:add-files");
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return paths.length > 0 ? invoke("local:add-files", { paths }) : Promise.resolve(null);
  },
  revealLocalTrack: (trackId) => invoke("local:reveal", { trackId }),
  // read here, not in the page: only a File the user picked or dropped has a path
  recognizeFile: async (file) => {
    const path = webUtils.getPathForFile(file);
    return path ? invoke("recognize:file", { path }) : null;
  },
  saveAsFiles: (request) => invoke("export:save-files", request),
  saveDocument: (request) => invoke("export:save-document", request),
  clipBegin: (name) => invoke("visual:clip-begin", { name }),
  clipWrite: (id, bytes) => invoke("visual:clip-write", { id, bytes }),
  clipAudio: (id, bytes) => invoke("visual:clip-audio", { id, bytes }),
  clipFinish: (request) => invoke("visual:clip-finish", request),
  clipCancel: (id) => invoke("visual:clip-cancel", { id }),
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
  checkForUpdate: () => invoke("update:check"),
  installUpdate: () => invoke("update:install"),
  openReleasePage: () => invoke("update:open-release"),
  setGlobalShortcuts: (bindings) => invoke("shortcuts:set-global", bindings),
  notchUpdateLyrics: (lyrics) => ipcRenderer.send("notch:lyrics", lyrics),
  notchUpdatePlaylists: (playlists) => ipcRenderer.send("notch:playlists", playlists),
  notchUpdateSettings: (settings) => ipcRenderer.send("notch:settings", settings),
  togglePocket: () => invoke("pocket:toggle"),
  getPocketStatus: () => invoke("pocket:status"),
  onPocketOpen: on("pocket:open"),
  pocketUpdateFeed: (feed) => ipcRenderer.send("pocket:feed", feed),
  getPanelStatus: () => invoke("panel:get-status"),
  installPanelWidget: () => invoke("panel:install"),
  enablePanelWidget: () => invoke("panel:enable"),
  openExtensionsApp: () => invoke("panel:open-extensions"),
  youtubeCall: (op, args) => invoke("nuvo-yt:call", { op, args }),
  listSystemFonts: (rescan = false) => invoke("fonts:list-system", { rescan }),
  importFontFile: () => invoke("fonts:import-file"),
  deleteFontFile: (id) => invoke("fonts:delete", { id }),
  importWallpaper: (file) => importFile("wallpaper:import", file),
  clearWallpaper: () => invoke("wallpaper:clear"),
  importSceneMedia: (file) => importFile("scene-media:import", file),
  pickCoverImage: () => invoke("playlist:cover-pick"),
  exportTheme: (name, text) => invoke("theme:export", { name, text }),
  importThemeFile: () => invoke("theme:import"),
  appearanceReady: () => ipcRenderer.send("appearance:ready"),
  appearanceApplying: () => ipcRenderer.send("appearance:applying"),
  setThumbarLabels: (labels) => ipcRenderer.send("thumbar:labels", labels),
};

contextBridge.exposeInMainWorld("nuvoShell", shell);
