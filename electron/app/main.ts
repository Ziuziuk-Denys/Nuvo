import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  type Session,
} from "electron";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CORE_SCHEME, CORE_SCHEME_PRIVILEGES, forwardToCore } from "../core-bridge";
import { createCoreHost } from "../core-host";
import { NotchWindow, registerNotchIpc } from "../notch/window";
import { canPlaceNotch, detectNotchSession } from "../notch/session";
import { loadKwinScript, unloadKwinScript } from "../notch/kwin";
import { createCompositorBridge, detectCompositor, type Exec } from "./compositor";
import { findLinkArg, LinkInbox } from "./deeplink";
import { countsAsFailedStart, isShiftAtStart, SAFE_FLAG, StartWatch } from "./appearanceSafeMode";
import { FC_LIST_MAX_BYTES, fontResponse, FontStore, MAX_FONT_FILE_BYTES, parseFcList, readCapped, SystemFonts, type FontImport } from "./fonts";
import { DISCORD_APPLICATION_ID, DiscordPresence, socketCandidates } from "./discord";
import { CHANNELS, IpcRegistry } from "./ipc";
import { chromiumRule, credentialsOf, detectSystemProxy, networkBody, withCredentials, type ProxySources } from "./proxy";
import { chromiumUsage, CrashPolicy, IconInstaller, revealTarget, homeRoots, Shutdown, SleepBlocker } from "./lifecycle";
import { APP_ID, applySwitches, guardContents, keepUserData, MainWindowController, onSecondInstance, takeInstanceLock } from "./mainWindow";
import { allowCheck, allowRequest, contentSecurityPolicy } from "./policy";
import { notchActionToCommand, PlayerRelay, toNotchState } from "./relay";
import { startPanelBus, type PanelBus } from "./panelBus";
import { entryTarget, syncDesktopEntry } from "./desktopEntry";
import { enablePanelWidget, installPanelWidget, openExtensionsApp, panelFilesPresent, panelInstallAllowed, panelSource, panelTarget } from "./panelWidget";
import { relaxCors, rewriteRequestHeaders } from "./requestRules";
import { saveFilter, validateSaveText, writeTextAtomic } from "./saveText";
import { coreCall } from "./coreCall";
import { coreBinaryName, coreSocketPath } from "./socketPath";
import { createBackend, parseFeed, releasePageUrl, Updater, updateMode, type AutoUpdaterLike, type UpdateBackend } from "./updater";
import { createFileActions } from "./fileActions";
import { readCoverFile, type CoverRead } from "./coverFile";
import { writeBufferAtomic } from "./files";
import { MainSettingsStore } from "./settings";
import { GlobalShortcuts, PLAYER_COMMAND_IDS } from "./shortcuts";
import { exclusive } from "./exclusive";
import { readThemeFile, themeFileName, validateThemeExport, writeThemeFile, type ThemeFileRead } from "./themeFiles";
import { systemMuted, unmuteSystem } from "./systemSound";
import { probeWatcher, TrayController, trayIconStyle, trayWanted, type TrayItemId } from "./tray";
import { RateGate, RefusalLog, validateBindings, validateIcon, validateNotchAction, validateNotice, validateSurfaceState } from "./validate";
import { nextZoom, zoomKey } from "./zoom";
import { activateWindow, DEFAULT_SIZE, MIN_SIZE, navigationDecision, onScreenBounds } from "./windowRules";

export interface YoutubeService {
  dispose(): void;
}
export type StartYoutubeService = (deps: { partition: Session; log: (message: string) => void }) => YoutubeService;

const log = (message: string, error?: unknown) => console.warn(message, error ?? "");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const compositor = detectCompositor(process.env, process.argv, process.platform);
const children = new Set<{ kill(): void }>();

const execFileAsync = promisify(execFile);
/** Proxy settings have no change event on Linux; a VPN client turning its proxy on is seen within this time. */
const PROXY_POLL_MS = 30_000;
const PROXY_PUT_TIMEOUT_MS = 3000;

const trackedExec: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      children.delete(child);
      if (error) reject(error);
      else resolve(stdout);
    });
    children.add(child);
  });

keepUserData(app);
// Without it Windows groups the taskbar button and names notifications "electron.app.Nuvo", apart from the installer's shortcuts
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
applySwitches(app, compositor !== "none");
protocol.registerSchemesAsPrivileged([{ scheme: CORE_SCHEME, privileges: CORE_SCHEME_PRIVILEGES }]);
process.on("uncaughtException", (error) => log("[main] uncaught", error));
process.on("unhandledRejection", (error) => log("[main] unhandled rejection", error));

export function runMain(startYoutube: StartYoutubeService | null): void {
  if (!takeInstanceLock(app, (line) => console.log(line))) return;

  const settings = new MainSettingsStore(path.join(app.getPath("userData"), "main-settings.json"), safeStorage, log);
  const fonts = new FontStore(path.join(app.getPath("userData"), "fonts"));
  const startWatch = new StartWatch({ get: () => settings.value.appearance, set: (flags) => settings.setAppearance(flags) });
  if (process.argv.includes(SAFE_FLAG)) startWatch.forceSafe();
  const systemFonts = new SystemFonts(
    () =>
      new Promise((resolve) =>
        execFile("fc-list", ["--format", "%{family}\n"], { timeout: 5000, maxBuffer: FC_LIST_MAX_BYTES, windowsHide: true }, (error, stdout) => {
          resolve(error ? { ok: false } : { ok: true, families: parseFcList(stdout) });
        }),
      ),
  );
  const oneFontDialog = exclusive<FontImport | { ok: false; error: "cancelled" }>({ ok: false, error: "cancelled" });
  const oneThemeDialog = exclusive<boolean | "failed">(false);
  const oneThemeOpenDialog = exclusive<ThemeFileRead>({ ok: false, error: "cancelled" });
  const oneFileDialog = exclusive<unknown>(null);
  const oneCoverDialog = exclusive<CoverRead>({ ok: false, error: "cancelled" });
  const relay = new PlayerRelay();
  const crash = new CrashPolicy(Date.now);
  const blocker = new SleepBlocker({ start: (type) => powerSaveBlocker.start(type), stop: (id) => powerSaveBlocker.stop(id) });
  const refusals = new RefusalLog(log, Date.now);
  const appFile = path.join(import.meta.dirname, "../dist/index.html");
  // percent-encoded like the URL Chromium reports, so the navigation, IPC and permission checks compare like with like
  const appFileUrl = pathToFileURL(appFile).href;
  const appLocation = { indexUrl: appFileUrl, devServerUrl };
  // build/ is outside the default electron-builder files; package.json lists build/icons explicitly
  const iconFile = (size: number) => path.join(app.getAppPath(), "build", "icons", `${size}x${size}.png`);
  let notch: NotchWindow | null = null;
  let panelBus: PanelBus | null = null;
  let youtube: YoutubeService | null = null;
  let tray: TrayController | null = null;
  let trayIcon: Tray | null = null;
  let presetIcon: Buffer | null = null;
  const trayImage = () => {
    const style = trayIconStyle(process.env.XDG_CURRENT_DESKTOP ?? "", nativeTheme.shouldUseDarkColors);
    if (style !== "app") return nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icons", "tray", `nuvo-tray-${style.slice(5)}-32.png`));
    if (presetIcon) return nativeImage.createFromBuffer(presetIcon).resize({ width: 32, height: 32, quality: "best" });
    return nativeImage.createFromPath(iconFile(32));
  };
  let lastSaveDir: string | null = null;

  const socketPath = coreSocketPath({ platform: process.platform, env: process.env, tmpdir: os.tmpdir(), random: randomBytes(16).toString("hex") });
  const coreBinary = coreBinaryName(process.platform);
  const core = createCoreHost({
    binaryPath: app.isPackaged ? path.join(process.resourcesPath, "bin", coreBinary) : path.join(app.getAppPath(), "core", "target", "debug", coreBinary),
    socketPath,
    env: process.env,
    onStatus: (status) => {
      sendToMain(CHANNELS.coreStatus, status);
      // a restarted daemon starts direct; it has to hear the proxy again
      if (status === "ready") inProxyOrder(putNetwork);
    },
  });

  const windows = new MainWindowController({
    create: () => {
      const win = new BrowserWindow({
        title: "Nuvo",
        ...DEFAULT_SIZE,
        minWidth: MIN_SIZE.width,
        minHeight: MIN_SIZE.height,
        frame: false,
        transparent: true,
        hasShadow: false,
        fullscreenable: true,
        show: false,
        icon: nativeImage.createFromPath(iconFile(512)),
        webPreferences: {
          preload: path.join(import.meta.dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
      win.once("ready-to-show", () => {
        win.show();
        win.focus();
      });
      win.on("show", () => tray?.sync());
      win.on("hide", () => tray?.sync());
      win.webContents.on("console-message", (event) => {
        const level = event.level;
        if (devServerUrl || level === "warning" || level === "error") console.log(`[renderer:${level}] ${event.message}`);
      });
      const createdAt = Date.now();
      win.webContents.on("did-start-loading", () => startWatch.loadStarted());
      // file:// pages keep no zoom of their own, so every load starts at the kept level
      win.webContents.on("did-finish-load", () => win.webContents.setZoomLevel(settings.value.zoomLevel));
      win.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
        if (countsAsFailedStart(code, isMainFrame)) startWatch.failed();
      });
      win.webContents.on("before-input-event", (event, input) => {
        if (isShiftAtStart(input, Date.now() - createdAt) && !settings.value.appearance.safe) {
          startWatch.forceSafe();
          win.webContents.reload();
        }
        const zoom = zoomKey(input);
        if (zoom) {
          const level = nextZoom(settings.value.zoomLevel, zoom);
          win.webContents.setZoomLevel(level);
          settings.setZoom(level);
          event.preventDefault();
          return;
        }
        const devtools = input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
        if (devtools && (!app.isPackaged || process.env.NUVO_DEVTOOLS === "1")) {
          win.webContents.toggleDevTools();
          event.preventDefault();
        }
      });
      if (devServerUrl) void win.loadURL(devServerUrl);
      else void win.loadFile(appFile);
      return win;
    },
    quitting: () => shutdown.quitting,
    keepInTray: () => settings.value.keepInTray,
    trayAvailable: () => tray?.isAvailable ?? false,
    trayHintShown: () => settings.value.trayHintShown,
    markTrayHintShown: () => settings.set("trayHintShown", true),
    notify: (text) => new Notification({ title: "Nuvo", body: text }).show(),
    startQuit: () => void shutdown.run(),
    tiling: compositor === "hyprland" || compositor === "sway",
    openExternal: (url) => void shell.openExternal(url),
    devServerUrl,
    appFileUrl,
    onRendererGone: () => {
      startWatch.failed();
      relay.rendererGone(Date.now());
      inbox.rendererGone();
    },
    reloadAllowed: () => crash.shouldReload(),
    log,
  });
  const mainContents = () => windows.window?.webContents ?? null;
  const sendToMain = (channel: string, payload?: unknown) => mainContents()?.send(channel, payload);

  const keepOnScreen = () => {
    const win = windows.window;
    if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
    const bounds = win.getBounds();
    const next = onScreenBounds(
      bounds,
      screen.getAllDisplays().map((display) => display.workArea),
    );
    if (next !== bounds) win.setBounds(next);
  };

  let loadedBackend: Promise<UpdateBackend> | undefined;
  const backend = () => (loadedBackend ??= import("electron-updater").then((pkg) => createBackend(pkg.default.autoUpdater as unknown as AutoUpdaterLike)));
  const updater = new Updater({
    mode: updateMode({ platform: process.platform, packaged: app.isPackaged, appImage: Boolean(process.env.APPIMAGE) }),
    enabled: () => settings.value.autoUpdate,
    backend: {
      check: async () => (await backend()).check(),
      download: async (onProgress) => (await backend()).download(onProgress),
      quitAndInstall: () => void backend().then((b) => b.quitAndInstall()),
    },
    emit: (view) => sendToMain(CHANNELS.updateState, view),
    log,
  });
  const inbox = new LinkInbox(
    (target) => sendToMain(CHANNELS.linkOpen, target),
    () => windows.show(),
  );
  const shortcuts = new GlobalShortcuts(
    globalShortcut,
    () => true,
    (commandId) => {
      const type = PLAYER_COMMAND_IDS[commandId];
      if (type) sendToMain(CHANNELS.playerCommand, { type });
      else sendToMain(CHANNELS.appCommand, { commandId });
    },
  );
  const discord = new DiscordPresence({
    applicationId: DISCORD_APPLICATION_ID,
    candidates: () => socketCandidates(process.env),
    connect: (p) => net.createConnection(p),
    now: Date.now,
    pid: process.pid,
    log,
  });
  const icons = new IconInstaller({
    packaged: app.isPackaged,
    platform: process.platform,
    dataHome: process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    // the Icon= key electron-builder writes into the .desktop file: build.linux.executableName
    iconName: "nuvo",
    scale: (png, size) => nativeImage.createFromBuffer(png).resize({ width: size, height: size, quality: "best" }).toPNG(),
    refreshCache: (dir) => trackedExec("gtk-update-icon-cache", ["-f", "-t", dir], 5000).then(() => undefined),
    setWindowIcon: (png) => windows.window && (windows.window as unknown as BrowserWindow).setIcon(nativeImage.createFromBuffer(png)),
  });

  // an AppImage has no installer: Nuvo writes its own menu entry so the desktop can match the window to an icon
  const menuEntryAvailable = () => app.isPackaged && process.platform === "linux" && entryTarget(process.env, os.homedir()) !== null;
  const syncMenuEntry = () =>
    syncDesktopEntry(settings.value.menuEntry, {
      env: process.env,
      home: os.homedir(),
      icon: (size) => fs.readFileSync(iconFile(size)),
      refreshCache: (dir) => trackedExec("gtk-update-icon-cache", ["-f", "-t", dir], 5000).then(() => undefined),
    }).catch((error: unknown) => log(`[menu-entry] ${String(error)}`));

  const shutdown: Shutdown = new Shutdown({
    askRenderer: (deadlineMs) => {
      const contents = mainContents();
      if (!contents) return null;
      contents.send(CHANNELS.appBeforeQuit, { deadlineMs });
      return new Promise<void>((resolve) => ipcMain.once(CHANNELS.appQuitReady, () => resolve()));
    },
    steps: [
      ["daemon", () => core.stop()],
      ["notch", () => notch?.destroy()],
      ["discord", () => discord.stop()],
      ["panel", () => panelBus?.close()],
      ["youtube", () => youtube?.dispose()],
      ["tray", () => tray?.dispose()],
      ["shortcuts", () => globalShortcut.unregisterAll()],
      ["children", () => children.forEach((c) => c.kill())],
      ["blocker", () => blocker.release()],
      ["windows", () => BrowserWindow.getAllWindows().forEach((w) => w.destroy())],
    ],
    quit: () => app.quit(),
    exit: (code) => app.exit(code),
    log,
  });

  function startNotch(): void {
    if (notch) return;
    notch = new NotchWindow({
      preloadPath: path.join(import.meta.dirname, "preload-notch.cjs"),
      icon: nativeImage.createFromPath(iconFile(512)),
      loadPage: (win) => (devServerUrl ? win.loadURL(`${devServerUrl}#/notch`) : win.loadFile(appFile, { hash: "/notch" })),
      session: detectNotchSession(
        process.env,
        process.argv.includes("--ozone-platform=x11") || process.argv.includes("--ozone-platform-hint=x11"),
        process.platform,
      ),
      bridge: createCompositorBridge(compositor, process.env, process.pid, log, trackedExec),
      loadKwin: loadKwinScript,
      unloadKwin: unloadKwinScript,
      getMainWindow: () => (windows.window as unknown as BrowserWindow) ?? null,
    });
    registerNotchIpc(notch, {
      onAction: (raw) => {
        const action = validateNotchAction(raw);
        if (!action) return refusals.refuse("notch:action", "shape");
        const command = notchActionToCommand(action, relay.latest.liked);
        if (command) sendToMain(CHANNELS.playerCommand, command);
      },
      onLyrics: (lyrics) => panelBus?.service.setLyrics(lyrics),
    });
    notch.setState(toNotchState(relay.latest));
    // e2e tests read lastShape and ready through app.evaluate
    if (!app.isPackaged) (globalThis as { nuvoNotch?: NotchWindow }).nuvoNotch = notch;
  }

  async function startPanel(): Promise<void> {
    panelBus = await startPanelBus({
      mprisName: `org.mpris.MediaPlayer2.chromium.instance${process.pid}`,
      command: (command) => sendToMain(CHANNELS.playerCommand, command),
      show: () => windows.show(),
      now: Date.now,
    });
    panelBus?.service.update(relay.latest);
  }

  function installSession(target: Session): void {
    target.webRequest.onBeforeSendHeaders((details, done) =>
      done({ requestHeaders: rewriteRequestHeaders(details.url, details.requestHeaders) as Record<string, string> }),
    );
    target.webRequest.onHeadersReceived((details, done) => {
      const relaxed = relaxCors(
        details.url,
        details.method,
        (details.responseHeaders ?? {}) as Record<string, string[]>,
        details.statusLine ?? "HTTP/1.1 200 OK",
      );
      const headers = relaxed.headers as Record<string, string[]>;
      if (devServerUrl && details.url.startsWith(devServerUrl) && details.resourceType === "mainFrame") {
        headers["Content-Security-Policy"] = [contentSecurityPolicy({ wasm: true, appleMusic: true, devServer: new URL(devServerUrl).origin })];
      }
      done({ responseHeaders: headers, statusLine: relaxed.statusLine });
    });
  }

  function registerIpc(): void {
    const ipc = new IpcRegistry(ipcMain, {
      contents: (who) => (who === "main" ? mainContents() : (notch?.webContents ?? null)),
      page: () => ({ fileUrl: appFileUrl, devOrigin: devServerUrl }),
      refused: (channel) => refusals.refuse(channel, "sender"),
    });
    ipc.handle(CHANNELS.winMinimize, "main", () => windows.minimize());
    ipc.handle(CHANNELS.winToggleMaximize, "main", () => windows.toggleMaximize());
    ipc.handle(CHANNELS.winToggleFullscreen, "main", () => windows.toggleFullscreen());
    ipc.handle(CHANNELS.winClose, "main", () => windows.close());
    ipc.handle(CHANNELS.winGetState, "main", () => windows.state());
    ipc.handle(CHANNELS.appInfo, "main", () => ({
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      compositor,
      tiling: compositor === "hyprland" || compositor === "sway",
    }));
    ipc.handle(CHANNELS.appQuit, "main", () => shutdown.run());
    ipc.handle(CHANNELS.appNotify, "main", (payload) => {
      const notice = validateNotice(payload);
      if (!notice) return refusals.refuse(CHANNELS.appNotify, "shape");
      const win = windows.window as unknown as BrowserWindow | null;
      if (!win || win.isFocused() || !Notification.isSupported()) return false;
      const shown = new Notification({ title: notice.title, body: notice.body });
      shown.on("click", () => windows.show());
      shown.show();
      return true;
    });
    ipc.handle(CHANNELS.iconApply, "main", (payload) => {
      const icon = validateIcon(payload);
      if (!icon) return refusals.refuse(CHANNELS.iconApply, "shape");
      presetIcon = icon.stock ? null : Buffer.from(icon.pngDataUrl.slice("data:image/png;base64,".length), "base64");
      trayIcon?.setImage(trayImage());
      return icons.apply(icon.pngDataUrl, icon.stock);
    });
    ipc.handle(CHANNELS.shellReveal, "main", (payload) => {
      const target = revealTarget((payload as { path?: unknown } | null)?.path, homeRoots(app.getPath("downloads"), lastSaveDir));
      if (!target) return false;
      if (target.folder) void shell.openPath(target.path);
      else shell.showItemInFolder(target.path);
      return true;
    });
    ipc.handle(CHANNELS.fileSaveText, "main", async (payload) => {
      const file = validateSaveText(payload);
      if (!file) return refusals.refuse(CHANNELS.fileSaveText, "shape");
      const options = { defaultPath: path.join(lastSaveDir ?? app.getPath("downloads"), file.name), filters: [saveFilter(file.name)] };
      const win = windows.window as unknown as BrowserWindow | null;
      const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return false;
      await writeTextAtomic(picked.filePath, file.text);
      lastSaveDir = path.dirname(picked.filePath);
      return true;
    });
    ipc.handle(CHANNELS.chromiumUsage, "main", () => chromiumUsage(app.getPath("userData"), () => session.defaultSession.getCacheSize()));
    ipc.handle(CHANNELS.soundSystemMuted, "main", () => (process.platform === "linux" ? systemMuted(process.pid) : null));
    ipc.handle(CHANNELS.soundUnmuteSystem, "main", () => (process.platform === "linux" ? unmuteSystem(process.pid) : undefined));
    ipc.handle(CHANNELS.chromiumClear, "main", async (payload) => {
      if ((payload as { scope?: unknown } | null)?.scope !== "http") return false;
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
      return true;
    });
    ipc.handle(CHANNELS.linkTakePending, "main", () => inbox.take());
    ipc.handle(CHANNELS.coreGetStatus, "main", () => core.getStatus());
    const states = new RateGate(10, (state: ReturnType<typeof validateSurfaceState>) => state && relay.accept(state), Date.now);
    ipc.on(CHANNELS.playerState, "main", (payload) => {
      const state = validateSurfaceState(payload);
      if (state) states.offer(state);
      else refusals.refuse(CHANNELS.playerState, "shape");
    });
    ipc.handle(CHANNELS.trayGetStatus, "main", () => ({ available: tray?.isAvailable ?? false, keepInTray: settings.value.keepInTray }));
    // the proxy in force with its login left out, so Settings can say what the automatic mode found
    ipc.handle(CHANNELS.settingsGet, "main", () => ({
      ...settings.view(),
      proxyInForce: proxyInForce?.replace(/\/\/[^/@]*@/, "//") ?? null,
      menuEntryAvailable: menuEntryAvailable(),
    }));
    ipc.handle(CHANNELS.settingsSet, "main", (payload) => {
      const { key, value } = (payload ?? {}) as { key?: unknown; value?: unknown };
      if (typeof key !== "string") return { ok: false, error: "key must be a string" };
      const result = settings.set(key, value);
      if (result.ok && key === "discord") discord.setEnabled(settings.value.discord.enabled);
      if (result.ok && key === "proxy") void applyProxy();
      if (result.ok && key === "autoUpdate") updater.setEnabled(settings.value.autoUpdate);
      if (result.ok && key === "menuEntry") void syncMenuEntry();
      if (result.ok && key === "keepInTray") tray?.sync();
      return result;
    });
    ipc.handle(CHANNELS.discordStatus, "main", () => discord.current);
    const panelResources = app.isPackaged ? path.join(process.resourcesPath, "desktop") : path.join(app.getAppPath(), "desktop");
    const panelFor = () => {
      const session = notch?.session ?? "other-wayland";
      return process.platform === "linux" ? panelTarget(session, process.env) : null;
    };
    const panelPending = path.join(app.getPath("userData"), "panel-enable-pending");
    const panelAllowed = () => panelInstallAllowed(process.env, os.homedir());
    ipc.handle(CHANNELS.panelGetStatus, "main", () => {
      const session = notch?.session ?? "other-wayland";
      const target = panelFor();
      return {
        session,
        supported: canPlaceNotch(session),
        placementError: notch?.placementError ?? null,
        panel: target
          ? {
              target,
              available: panelFilesPresent(target, panelResources),
              manual: !panelAllowed(),
              source: panelSource(target, panelResources),
              pendingEnable: target === "gnome" && fs.existsSync(panelPending),
            }
          : null,
      };
    });
    ipc.handle(CHANNELS.panelInstall, "main", () => {
      const target = panelFor();
      if (!target) return { ok: false, error: "unsupported" };
      return installPanelWidget(target, {
        resources: panelResources,
        configHome: process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        exec: trackedExec,
        pendingFile: panelPending,
        allowed: panelAllowed(),
      });
    });
    ipc.handle(CHANNELS.panelEnable, "main", () => {
      if (panelFor() !== "gnome") return { ok: false, error: "unsupported" };
      if (!panelAllowed()) return { ok: false, error: "manual" };
      return enablePanelWidget({ exec: trackedExec, pendingFile: panelPending });
    });
    ipc.handle(CHANNELS.panelOpenExtensions, "main", () => {
      if (panelFor() !== "gnome") return false;
      return openExtensionsApp(
        (file, args) =>
          new Promise<boolean>((resolve) => {
            const child = spawn(file, args, { detached: true, stdio: "ignore" });
            child.once("error", () => resolve(false));
            child.once("spawn", () => {
              child.unref();
              resolve(true);
            });
          }),
      );
    });
    ipc.handle(CHANNELS.updateGetState, "main", () => updater.view());
    ipc.handle(CHANNELS.updateInstall, "main", () => updater.install());
    ipc.handle(CHANNELS.updateOpenRelease, "main", () => {
      // the page comes from the build config, never from the renderer
      if (updater.view().mode !== "notify") return false;
      try {
        const feed = parseFeed(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
        if (feed) void shell.openExternal(releasePageUrl(feed));
        return feed !== null;
      } catch {
        return false;
      }
    });
    ipc.handle(CHANNELS.shortcutsSetGlobal, "main", (payload) => {
      const bindings = validateBindings(payload);
      return bindings ? shortcuts.set(bindings) : [];
    });
    registerAppearanceIpc(ipc);
  }

  function registerAppearanceIpc(ipc: IpcRegistry): void {
    const parent = () => windows.window as unknown as BrowserWindow;
    ipc.on(CHANNELS.appearanceReady, "main", () => startWatch.ready());
    ipc.on(CHANNELS.appearanceApplying, "main", () => startWatch.applying());
    ipc.handle(CHANNELS.fontsListSystem, "main", (payload) => systemFonts.get((payload as { rescan?: unknown } | null)?.rescan === true));
    ipc.handle(CHANNELS.fontsImport, "main", () =>
      oneFontDialog(async () => {
        const picked = await dialog.showOpenDialog(parent(), { properties: ["openFile"], filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff2"] }] });
        const file = picked.filePaths[0];
        if (picked.canceled || !file) return { ok: false, error: "cancelled" };
        try {
          const bytes = readCapped(file, MAX_FONT_FILE_BYTES);
          return bytes.length > MAX_FONT_FILE_BYTES ? { ok: false, error: "too_large" } : fonts.import(bytes, file);
        } catch {
          return { ok: false, error: "damaged" };
        }
      }),
    );
    ipc.handle(CHANNELS.playlistCoverPick, "main", () =>
      oneCoverDialog(async () => {
        const picked = await dialog.showOpenDialog(parent(), {
          properties: ["openFile"],
          filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
        });
        const file = picked.filePaths[0];
        return picked.canceled || !file ? { ok: false, error: "cancelled" } : readCoverFile(file);
      }),
    );
    ipc.handle(CHANNELS.fontsDelete, "main", (payload) => {
      const id = (payload as { id?: unknown } | null)?.id;
      return typeof id === "string" && fonts.remove(id);
    });
    ipc.handle(CHANNELS.themeExport, "main", (payload) => {
      const theme = validateThemeExport(payload);
      if (!theme) return refusals.refuse(CHANNELS.themeExport, "shape") ?? false;
      return oneThemeDialog(async () => {
        const picked = await dialog.showSaveDialog(parent(), {
          defaultPath: path.join(lastSaveDir ?? app.getPath("downloads"), themeFileName(theme.name)),
          filters: [{ name: "Nuvo theme", extensions: ["json"] }],
        });
        if (picked.canceled || !picked.filePath) return false;
        if (!writeThemeFile(picked.filePath, theme.text)) return "failed";
        lastSaveDir = path.dirname(picked.filePath);
        return true;
      });
    });
    ipc.handle(CHANNELS.themeImport, "main", () =>
      oneThemeOpenDialog(async () => {
        const picked = await dialog.showOpenDialog(parent(), { properties: ["openFile"], filters: [{ name: "Nuvo theme", extensions: ["json"] }] });
        const file = picked.filePaths[0];
        return picked.canceled || !file ? { ok: false, error: "cancelled" } : readThemeFile(file);
      }),
    );
    // folders and save paths come from these dialogs only; the daemon routes behind them are under /v1/fs/
    const files = createFileActions({
      call: (method, route, body) => coreCall(socketPath, core.token, method, route, body),
      pickFolder: async (title, defaultPath) => {
        const picked = await dialog.showOpenDialog(parent(), { title, defaultPath, properties: ["openDirectory", "createDirectory"] });
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
      },
      pickSavePath: async (title, defaultPath) => {
        const picked = await dialog.showSaveDialog(parent(), { title, defaultPath });
        return picked.canceled ? null : (picked.filePath ?? null);
      },
      musicDir: () => app.getPath("music"),
      documentsDir: () => app.getPath("documents"),
      lastDir: { get: () => lastSaveDir, set: (dir) => (lastSaveDir = dir) },
      showInFolder: (target) => shell.showItemInFolder(target),
      writeFile: writeBufferAtomic,
      refuse: (channel, why) => refusals.refuse(channel, why),
    });
    ipc.handle(CHANNELS.localAddFolder, "main", () => oneFileDialog(() => files.addFolder()));
    ipc.handle(CHANNELS.localReveal, "main", (payload) => files.reveal(payload));
    ipc.handle(CHANNELS.recognizeFile, "main", (payload) => files.grantRecognizeFile(payload));
    ipc.handle(CHANNELS.exportSaveFiles, "main", (payload) => oneFileDialog(() => files.saveFiles(payload)));
    ipc.handle(CHANNELS.exportSaveDocument, "main", (payload) => oneFileDialog(() => files.saveDocument(payload)));
  }

  function onTrayClick(id: TrayItemId): void {
    const latest = relay.latest;
    if (id === "show") return windows.show();
    if (id === "quit") return void shutdown.run();
    if (id === "resetAppearance") {
      startWatch.forceSafe();
      windows.show();
      return windows.window?.webContents.reload();
    }
    if (id === "toggle") return sendToMain(CHANNELS.playerCommand, { type: "toggle" });
    if (id === "next" || id === "previous") return sendToMain(CHANNELS.playerCommand, { type: id });
    if (id === "like") sendToMain(CHANNELS.playerCommand, { type: latest.liked ? "unlike" : "like" });
  }

  function startTray(): void {
    tray = new TrayController(
      {
        create: (onActivate) => {
          const icon = new Tray(trayImage());
          trayIcon = icon;
          icon.setToolTip("Nuvo");
          icon.on("click", onActivate);
          return {
            setMenu: (items) =>
              icon.setContextMenu(
                Menu.buildFromTemplate(
                  items.map((item) =>
                    item.kind === "separator"
                      ? { type: "separator" as const }
                      : { label: item.label, enabled: item.enabled, click: () => onTrayClick(item.id) },
                  ),
                ),
              ),
            destroy: () => {
              trayIcon = null;
              icon.destroy();
            },
          };
        },
        wanted: () => trayWanted({ keepInTray: settings.value.keepInTray, windowHidden: !(windows.window?.isVisible() ?? false), status: relay.latest.status }),
        onClick: onTrayClick,
        availabilityChanged: (available) => {
          if (!available && windows.window && !windows.window.isVisible()) windows.show();
        },
        activate: () => {
          const win = windows.window;
          if (!win) return windows.show();
          const action = activateWindow(
            { visible: win.isVisible(), focused: win.isFocused(), minimized: win.isMinimized() },
            settings.value.keepInTray && (tray?.isAvailable ?? false),
          );
          if (action === "hide") win.hide();
          else windows.show();
        },
      },
      () => probeWatcher(trackedExec),
    );
    void tray.start();
  }

  /** Both sessions, before any window loads: the YouTube worker must leave through the same door as the app. */
  const proxySessions = () => [session.defaultSession, session.fromPartition("persist:nuvo-yt")];
  let proxyInForce: string | null = null;
  let chromiumRuleSet = false;
  let proxyQueue: Promise<void> = Promise.resolve();

  const readProxySources = (): ProxySources => ({
    // An explicit rule of ours would only echo itself.
    resolve: () => (chromiumRuleSet ? Promise.resolve("DIRECT") : session.defaultSession.resolveProxy("https://www.youtube.com/")),
    env: process.env,
    gsettings: () => execFileAsync("gsettings", ["list-recursively", "org.gnome.system.proxy"], { timeout: 1500 }).then((result) => result.stdout),
    kioslaverc: () => fs.promises.readFile(path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "kioslaverc"), "utf8"),
  });

  async function refreshProxy(): Promise<void> {
    const proxy = settings.value.proxy;
    let url: string | null = null;
    let config: Electron.ProxyConfig = { mode: "system" };
    if (proxy.mode === "manual" && proxy.url) {
      url = withCredentials(proxy.url, proxy.username, settings.proxyPassword());
      config = { proxyRules: chromiumRule(proxy.url), proxyBypassRules: "<local>" };
    } else if (proxy.mode === "none") {
      config = { mode: "direct" };
    } else {
      const found = await detectSystemProxy(readProxySources());
      url = found.url;
      if (url && !found.chromiumSees) config = { proxyRules: chromiumRule(url), proxyBypassRules: "<local>" };
    }
    chromiumRuleSet = "proxyRules" in config;
    const changed = url !== proxyInForce;
    proxyInForce = url;
    await Promise.all(proxySessions().map((target) => target.setProxy(config)));
    if (!changed) return;
    await putNetwork();
    sendToMain(CHANNELS.networkChanged);
    // Not awaited: it can wait on a request that never ends, and the queue behind it must not.
    void Promise.allSettled(proxySessions().map((target) => target.closeAllConnections()));
  }

  /** One at a time, answers included: two requests in flight could reach the daemon in the wrong order. */
  function inProxyOrder(step: () => Promise<void>): Promise<void> {
    proxyQueue = proxyQueue.then(step).catch((error: unknown) => console.warn("proxy update failed", error));
    return proxyQueue;
  }

  const applyProxy = () => inProxyOrder(refreshProxy);

  function putNetwork(): Promise<void> {
    if (core.getStatus() !== "ready") return Promise.resolve();
    return new Promise((resolve) => {
      const request = http.request(
        {
          socketPath,
          path: "/v1/system/network",
          method: "PUT",
          timeout: PROXY_PUT_TIMEOUT_MS,
          headers: { authorization: `Bearer ${core.token}`, "content-type": "application/json" },
        },
        (response) => {
          response.resume();
          if (response.statusCode !== 204) console.warn(`the daemon refused the proxy: ${response.statusCode}`);
          resolve();
        },
      );
      request.on("timeout", () => request.destroy());
      request.on("error", (error) => {
        console.warn("the daemon did not take the proxy", error.message);
        resolve();
      });
      request.end(networkBody(proxyInForce));
    });
  }

  // Every web contents, before it loads: no window.open, navigation only to its own pages
  app.on("web-contents-created", (_event, contents) => {
    const appPages = contents.session === session.defaultSession;
    guardContents(contents, appPages ? (url) => navigationDecision(url, devServerUrl, appFileUrl) === "allow" : (url) => url.startsWith("https://"));
  });
  // Chromium asks here for a proxy that wants a login; the daemon has the same credentials in its URL.
  app.on("login", (event, _contents, _details, authInfo, answer) => {
    const credentials = authInfo.isProxy ? credentialsOf(proxyInForce) : null;
    if (!credentials) return;
    event.preventDefault();
    answer(credentials.username, credentials.password);
  });
  app.on("second-instance", (_event, argv) =>
    onSecondInstance(argv, { quitting: shutdown.quitting, app, show: () => windows.show(), receiveLink: (raw) => inbox.receive(raw), findLink: findLinkArg }),
  );
  app.on("window-all-closed", () => {
    if (!windows.window || shutdown.quitting) void shutdown.run();
  });
  app.on("before-quit", (event) => {
    if (shutdown.quitting) return;
    event.preventDefault();
    void shutdown.run();
  });

  void app.whenReady().then(async () => {
    if (menuEntryAvailable()) void syncMenuEntry();
    void core.start();
    const allowedOrigins = ["file://", "null", ...(devServerUrl ? [new URL(devServerUrl).origin] : [])];
    protocol.handle(CORE_SCHEME, (request) => {
      const url = new URL(request.url);
      if (url.hostname === "local" && url.pathname.startsWith("/fonts/")) return fontResponse(request, fonts, allowedOrigins);
      return forwardToCore(request, { socketPath, token: core.token, waitReady: () => core.whenReady(), allowedOrigins });
    });
    screen.on("display-removed", keepOnScreen);
    screen.on("display-metrics-changed", keepOnScreen);
    await applyProxy();
    setInterval(() => void applyProxy(), PROXY_POLL_MS).unref();
    powerMonitor.on("resume", () => void applyProxy());
    updater.start();
    installSession(session.defaultSession);
    const youtubePartition = session.fromPartition("persist:nuvo-yt");
    installSession(youtubePartition);
    // deny by default until the worker service states what it needs
    youtubePartition.setPermissionCheckHandler(() => false);
    youtubePartition.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    // the full requesting URL, never the bare origin: every file:// page shares the origin "file://"
    session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) =>
      allowCheck(permission, details.requestingUrl ?? "", details, appLocation),
    );
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) =>
      done(allowRequest(permission, details.requestingUrl ?? "", details as { mediaTypes?: string[] }, appLocation)),
    );
    if (app.isPackaged) app.setAsDefaultProtocolClient("nuvo");
    else app.setAsDefaultProtocolClient("nuvo", process.execPath, [path.resolve(process.argv[1] ?? ".")]);
    registerIpc();
    // before the window loads: the renderer sends the Notch settings as soon as it mounts
    startNotch();
    relay.read((state) => {
      notch?.setState(toNotchState(state));
      panelBus?.service.update(state);
      tray?.update(state);
      discord.update(state);
      blocker.update(state.status);
    });
    windows.show();
    inbox.receive(findLinkArg(process.argv));
    youtube = startYoutube ? startYoutube({ partition: youtubePartition, log }) : null;
    startTray();
    // Plasma's mono glyph follows the light or dark theme
    nativeTheme.on("updated", () => trayIcon?.setImage(trayImage()));
    discord.setEnabled(settings.value.discord.enabled);
    if (process.platform === "linux") void startPanel();
  });
}
