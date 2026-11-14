export interface FrameLike {
  url: string;
}

export interface IpcEventLike {
  sender: unknown;
  senderFrame?: FrameLike | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void;
}

export type Who = "main" | "notch";

export interface IpcGuard {
  contents(who: Who): unknown;
  page(who: Who): { fileUrl?: string; devOrigin?: string };
  refused(channel: string): void;
}

export class IpcRegistry {
  constructor(
    private readonly ipc: IpcMainLike,
    private readonly guard: IpcGuard,
  ) {}

  private allowed(who: Who, event: IpcEventLike): boolean {
    const expected = this.guard.contents(who);
    if (expected === null || expected === undefined || event.sender !== expected) return false;
    // only the top frame of that window, showing the app's own page
    const frame = event.senderFrame;
    if (!frame || frame !== (expected as { mainFrame?: unknown }).mainFrame) return false;
    try {
      const url = new URL(frame.url);
      const page = this.guard.page(who);
      if (page.devOrigin && url.origin === new URL(page.devOrigin).origin) return true;
      url.hash = "";
      url.search = "";
      return page.fileUrl !== undefined && url.href === new URL(page.fileUrl).href;
    } catch {
      return false;
    }
  }

  handle(channel: string, who: Who, run: (payload: unknown) => unknown): void {
    this.ipc.handle(channel, (event, payload) => {
      if (!this.allowed(who, event)) {
        this.guard.refused(channel);
        throw new Error(`${channel}: sender not allowed`);
      }
      return run(payload);
    });
  }

  on(channel: string, who: Who, run: (payload: unknown) => void): void {
    this.ipc.on(channel, (event, payload) => {
      if (!this.allowed(who, event)) {
        this.guard.refused(channel);
        return;
      }
      run(payload);
    });
  }
}

export const CHANNELS = {
  winMinimize: "win:minimize",
  winToggleMaximize: "win:toggle-maximize",
  winToggleFullscreen: "win:toggle-fullscreen",
  winClose: "win:close",
  winGetState: "win:get-state",
  winState: "win:state",
  appInfo: "app:info",
  appQuit: "app:quit",
  appBeforeQuit: "app:before-quit",
  appQuitReady: "app:quit-ready",
  appNotify: "app:notify",
  iconApply: "icon:apply",
  shellReveal: "shell:reveal",
  fileSaveText: "file:save-text",
  localAddFolder: "local:add-folder",
  localReveal: "local:reveal",
  recognizeFile: "recognize:file",
  exportSaveFiles: "export:save-files",
  exportSaveDocument: "export:save-document",
  chromiumUsage: "chromium:usage",
  chromiumClear: "chromium:clear",
  soundSystemMuted: "sound:system-muted",
  soundUnmuteSystem: "sound:unmute-system",
  linkTakePending: "link:take-pending",
  linkOpen: "link:open",
  coreGetStatus: "core:get-status",
  coreStatus: "core:status",
  networkChanged: "network:changed",
  playerState: "player:state",
  playerCommand: "player:command",
  appCommand: "app:command",
  trayGetStatus: "tray:get-status",
  settingsGet: "settings:main-get",
  settingsSet: "settings:main-set",
  discordStatus: "discord:status",
  updateGetState: "update:get-state",
  updateState: "update:state",
  updateInstall: "update:install",
  updateOpenRelease: "update:open-release",
  shortcutsSetGlobal: "shortcuts:set-global",
  notchLyrics: "notch:lyrics",
  notchSettings: "notch:settings",
  panelGetStatus: "panel:get-status",
  panelInstall: "panel:install",
  panelEnable: "panel:enable",
  panelOpenExtensions: "panel:open-extensions",
  fontsListSystem: "fonts:list-system",
  fontsImport: "fonts:import-file",
  fontsDelete: "fonts:delete",
  wallpaperImport: "wallpaper:import",
  wallpaperClear: "wallpaper:clear",
  themeExport: "theme:export",
  themeImport: "theme:import",
  playlistCoverPick: "playlist:cover-pick",
  appearanceReady: "appearance:ready",
  appearanceApplying: "appearance:applying",
} as const;
