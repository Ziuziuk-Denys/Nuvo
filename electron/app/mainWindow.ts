/** Start-up helpers and the main window controller. Electron objects come in as narrow interfaces. */
import path from "node:path";
import {
  chromiumSwitches,
  closeDecision,
  minimizeAllowed,
  navigationDecision,
  relaunchArgs,
  toggleMaximizeAction,
  windowOpenDecision,
  type WinState,
} from "./windowRules";

export interface AppLike {
  getPath(name: "userData" | "appData"): string;
  setPath(name: "userData", value: string): void;
  setName(name: string): void;
  requestSingleInstanceLock(): boolean;
  quit(): void;
  exit(code: number): void;
  relaunch(options: { args: string[] }): void;
  commandLine: { appendSwitch(name: string, value?: string): void; hasSwitch(name: string): boolean; getSwitchValue(name: string): string };
}

/** Reverse DNS of nuvo.quest: build.appId, the .desktop name, the Flatpak and AppStream id, and the Windows AppUserModelID. */
export const APP_ID = "quest.nuvo.Nuvo";

/** The profile lives at <appData>/@nuvo/client, fixed: neither the package name nor the app name ("Nuvo", MPRIS identity) may move it.
 * An explicit --user-data-dir (dev and test runs) is honoured, so they never touch the real profile. */
export function keepUserData(app: AppLike): void {
  const explicit = app.commandLine.hasSwitch("user-data-dir") ? app.commandLine.getSwitchValue("user-data-dir") : "";
  const dir = explicit || path.join(app.getPath("appData"), "@nuvo", "client");
  app.setName("Nuvo");
  app.setPath("userData", dir);
}

export function applySwitches(app: AppLike, nativeWayland: boolean): void {
  for (const [name, value] of chromiumSwitches(nativeWayland)) app.commandLine.appendSwitch(name, value);
}

/** Without the lock: one line, quit, no window. */
export function takeInstanceLock(app: AppLike, print: (line: string) => void): boolean {
  if (app.requestSingleInstanceLock()) return true;
  print("Nuvo is already running");
  app.quit();
  return false;
}

export interface WindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  restore(): void;
  show(): void;
  hide(): void;
  focus(): void;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  setFullScreen(on: boolean): void;
  close(): void;
  destroy(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  webContents: {
    send(channel: string, payload?: unknown): void;
    reload(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  };
}

export interface MainWindowDeps {
  create(): WindowLike;
  quitting(): boolean;
  closeToTray(): boolean;
  trayAvailable(): boolean;
  trayHintShown(): boolean;
  markTrayHintShown(): void;
  notify(text: string): void;
  startQuit(): void;
  tiling: boolean;
  openExternal(url: string): void;
  devServerUrl: string | undefined;
  appFileUrl: string;
  onRendererGone(): void;
  reloadAllowed(): boolean;
  log(message: string): void;
}

export class MainWindowController {
  private win: WindowLike | null = null;

  constructor(private readonly deps: MainWindowDeps) {}

  get window(): WindowLike | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** The only way the window comes back: create, restore, show, focus. */
  show(): void {
    if (!this.window) this.win = this.build();
    const win = this.win!;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }

  build(): WindowLike {
    const win = this.deps.create();
    this.win = win;
    win.on("close", (event) => this.onClose(event as { preventDefault(): void }));
    for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "minimize", "restore", "hide", "show"]) {
      win.on(event, () => win.webContents.send("win:state", this.state()));
    }
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (windowOpenDecision(url) === "browser") this.deps.openExternal(url);
      return { action: "deny" };
    });
    // Electron 44 reports a main-frame navigation only as will-frame-navigate (will-navigate does not fire), so that one event carries the browser rule.
    win.webContents.on("will-frame-navigate", (event) => {
      const details = event as { url: string; isMainFrame: boolean; preventDefault(): void };
      const decision = navigationDecision(details.url, this.deps.devServerUrl, this.deps.appFileUrl);
      if (decision === "allow") return;
      details.preventDefault();
      if (decision === "browser" && details.isMainFrame) this.deps.openExternal(details.url);
    });
    // Redirects are only blocked: a redirect is no user intent to open the browser.
    win.webContents.on("will-redirect", (event) => {
      const details = event as { url: string; preventDefault(): void };
      if (navigationDecision(details.url, this.deps.devServerUrl, this.deps.appFileUrl) !== "allow") details.preventDefault();
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      if ((details as { reason?: string })?.reason === "clean-exit") return;
      this.deps.onRendererGone();
      if (crashRecovery(this.deps.reloadAllowed()) === "reload") win.webContents.reload();
      else {
        this.deps.log("[main] renderer gone twice within 60 s, not reloading");
        this.deps.notify("Nuvo hit a problem and stopped reloading. Quit it from the tray and start it again.");
        win.show();
      }
    });
    return win;
  }

  private onClose(event: { preventDefault(): void }): void {
    const decision = closeDecision({ quitting: this.deps.quitting(), closeToTray: this.deps.closeToTray(), trayAvailable: this.deps.trayAvailable() });
    if (decision === "close") return;
    event.preventDefault();
    if (decision === "quit") {
      this.deps.startQuit();
      return;
    }
    this.win?.hide();
    if (!this.deps.trayHintShown()) {
      this.deps.notify("Nuvo keeps playing in the tray.");
      this.deps.markTrayHintShown();
    }
  }

  state(): WinState {
    const win = this.window;
    if (!win) return { maximized: false, fullscreen: false, visible: false };
    return { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), visible: win.isVisible() && !win.isMinimized() };
  }

  minimize(): void {
    const win = this.window;
    if (win && minimizeAllowed({ fullscreen: win.isFullScreen(), tiling: this.deps.tiling })) win.minimize();
  }

  toggleMaximize(): void {
    const win = this.window;
    if (!win) return;
    const action = toggleMaximizeAction({ fullscreen: win.isFullScreen(), maximized: win.isMaximized() });
    if (action === "leave-fullscreen") win.setFullScreen(false);
    else if (action === "restore") win.unmaximize();
    else win.maximize();
  }

  toggleFullscreen(): void {
    const win = this.window;
    if (win) win.setFullScreen(!win.isFullScreen());
  }

  close(): void {
    this.window?.close();
  }
}

/** A second launch: relaunch when quitting, else show and deliver the link. */
export function onSecondInstance(
  argv: string[],
  deps: { quitting: boolean; app: AppLike; show(): void; receiveLink(raw: string | null): void; findLink(argv: string[]): string | null },
): void {
  if (deps.quitting) {
    deps.app.relaunch({ args: relaunchArgs(argv) });
    deps.app.exit(0);
    return;
  }
  deps.show();
  deps.receiveLink(deps.findLink(argv));
}

/** The first crash in a minute reloads; a repeat leaves the window up with a notice instead of a silent dead page. */
export function crashRecovery(reloadAllowed: boolean): "reload" | "notice" {
  return reloadAllowed ? "reload" : "notice";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Saved bounds are kept only when they still overlap a display; the size is clamped to that display's work area. Otherwise: default size, centred on the primary display. */
export function restoreBounds(saved: Rect | null, workAreas: Rect[], primary: Rect, defaults: { width: number; height: number }): Rect {
  const fit = (area: Rect, size: { width: number; height: number }): Rect => {
    const width = Math.min(size.width, area.width);
    const height = Math.min(size.height, area.height);
    return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
  };
  if (!saved || !(saved.width > 0 && saved.height > 0) || ![saved.x, saved.y].every(Number.isFinite)) return fit(primary, defaults);
  // a window counts as visible when at least 100 px of it overlap a work area
  const target = workAreas.find(
    (a) =>
      Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x) >= 100 &&
      Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y) >= 100,
  );
  if (!target) return fit(primary, defaults);
  const width = Math.min(saved.width, target.width);
  const height = Math.min(saved.height, target.height);
  const x = Math.min(Math.max(saved.x, target.x), target.x + target.width - width);
  const y = Math.min(Math.max(saved.y, target.y), target.y + target.height - height);
  return { x, y, width, height };
}

export interface ContentsLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
}

/**
 * Applied to every web contents the app creates (main, Notch, YouTube worker): no window ever opens and navigation stays
 * on the `allowed` pages. Only blocks; the main window's controller adds its browser rule for the user's own clicks.
 */
export function guardContents(contents: ContentsLike, allowed: (url: string) => boolean): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
    contents.on(name, (event) => {
      const details = event as { url: string; preventDefault(): void };
      if (!allowed(details.url)) details.preventDefault();
    });
  }
}
