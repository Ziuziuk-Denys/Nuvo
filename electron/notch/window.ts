import { BrowserWindow, ipcMain, screen, type NativeImage } from "electron";
import {
  DEFAULT_NOTCH_SETTINGS,
  type Cutout,
  type NotchAction,
  type NotchHello,
  type NotchLyrics,
  type NotchPlaylists,
  type NotchPresence,
  type NotchSettings,
  type NotchState,
  type ShapeRect,
} from "../../src/notch/contracts";
import { ISLAND_SIZES, capturesPointer, islandRect, notchWindow } from "../../src/notch/lib/geometry";
import { overlayOrigin } from "../app/compositor";
import { kwinScript, type DisplayBounds } from "./placement";
import { canPlaceNotch, clicksPassThrough, notchEnabled, resolveEdge, type NotchSession } from "./session";

export const NOTCH_TITLE = "Nuvo Notch";

export interface OverlayPlacer {
  placeOverlay(request: {
    title: string;
    width: number;
    height: number;
    anchor: "top-left" | "top-center" | "top-right";
    pinned: boolean;
    margin: number;
    bounds?: "monitor" | "workArea";
    display?: DisplayBounds;
  }): Promise<boolean>;
}
const MOVE_SETTLE_MS = 300;
const ON_TOP_TRIES = 10;
const ON_TOP_RETRY_MS = 100;
const MAX_CRASH_RELOADS = 3;
const CRASH_WINDOW_MS = 60_000;
const CAPTURE_POLL_MS = 100;
const RAISE_MS = 1_000;
const FOCUS_SETTLE_MS = 50;
const LEAVE_MS = 160;

export interface NotchDeps {
  preloadPath: string;
  icon?: NativeImage;
  loadPage: (win: BrowserWindow) => Promise<void>;
  session: NotchSession;
  bridge: OverlayPlacer | null;
  loadKwin: (script: string) => Promise<boolean>;
  unloadKwin: () => Promise<void>;
  getMainWindow: () => BrowserWindow | null;
  readCutout?: (display: DisplayBounds) => Promise<Cutout | null>;
}

export class NotchWindow {
  ready: Promise<void> = Promise.resolve();

  private win: BrowserWindow | null = null;
  private main: BrowserWindow | null = null;
  private settings = DEFAULT_NOTCH_SETTINGS;
  private state: NotchState | null = null;
  private lyrics: NotchLyrics | null = null;
  private playlists: NotchPlaylists | null = null;
  private cutout: Cutout | null = null;
  private shape: ShapeRect | null = null;
  private capturing = false;
  private wantsCapture = false;
  private capturePoll: ReturnType<typeof setInterval> | null = null;
  private raiseTimer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;
  private placementFailure: string | null = null;
  private listening = false;
  private fullscreen = false;
  private placedDisplayId: number | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private focusSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private presence: NotchPresence = "out";
  private readonly replace = () => void this.place();
  private readonly replaceIfDisplayChanged = () => {
    if (this.pickDisplay().id !== this.placedDisplayId) this.replace();
  };
  private readonly onEnterFullscreen = () => this.setFullscreen(true);
  private readonly onLeaveFullscreen = () => this.setFullscreen(false);
  private readonly onMainFocus = () => this.syncMacFullscreenVisibility();
  private readonly onMainBlur = () => {
    if (this.focusSyncTimer) clearTimeout(this.focusSyncTimer);
    this.focusSyncTimer = setTimeout(() => {
      this.focusSyncTimer = null;
      this.syncMacFullscreenVisibility();
    }, FOCUS_SETTLE_MS);
  };
  private readonly onMainVisibility = () => {
    if (this.loaded && notchEnabled(this.settings.mode, this.deps.session)) this.ready = this.place();
  };
  private readonly onMainMove = () => {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(this.replaceIfDisplayChanged, MOVE_SETTLE_MS);
  };

  private crashTimes: number[] = [];

  constructor(private readonly deps: NotchDeps) {}

  get lastShape(): ShapeRect | null {
    return this.shape;
  }

  get capturesMouse(): boolean {
    return this.capturing;
  }

  get session(): NotchSession {
    return this.deps.session;
  }

  get placementError(): string | null {
    return this.placementFailure;
  }

  isMainSender(sender: unknown): boolean {
    const main = this.deps.getMainWindow();
    return Boolean(main && !main.isDestroyed() && sender === main.webContents);
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  applySettings(settings: NotchSettings): void {
    this.settings = settings;
    if (!notchEnabled(settings.mode, this.deps.session)) {
      if (this.win) this.destroy();
      return;
    }
    this.attachMain();
    if (!this.win || this.win.isDestroyed()) this.create();
    else if (this.loaded) this.ready = this.place();
    this.send("notch:settings", settings);
  }

  setState(state: NotchState): void {
    this.state = state;
    this.send("notch:state", state);
  }

  setLyrics(lyrics: NotchLyrics): void {
    this.lyrics = lyrics;
    this.send("notch:lyrics", lyrics);
  }

  setPlaylists(playlists: NotchPlaylists): void {
    this.playlists = playlists;
    this.send("notch:playlists", playlists);
  }

  setShape(rect: ShapeRect): void {
    if (!rect || typeof rect !== "object") return;
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every(Number.isFinite)) return;
    const left = Math.max(0, Math.round(rect.x));
    const top = Math.max(0, Math.round(rect.y));
    const size = notchWindow(this.cutout);
    const width = Math.min(size.width, Math.round(rect.x + rect.width)) - left;
    const height = Math.min(size.height, Math.round(rect.y + rect.height)) - top;
    if (width <= 0 || height <= 0) return;
    this.shape = { x: left, y: top, width, height };
    if (this.win && !this.win.isDestroyed() && !clicksPassThrough(this.deps.session)) this.win.setShape([this.shape]);
  }

  setCapture(capture: boolean): void {
    if (typeof capture !== "boolean" || !clicksPassThrough(this.deps.session)) return;
    this.wantsCapture = capture;
    this.syncCapture();
  }

  private syncCapture(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    // Windows can drop forwarded moves or send a stray mouseleave, so the cursor position also counts.
    const capture = this.wantsCapture || this.cursorOnShape(win);
    if (capture === this.capturing) return;
    this.capturing = capture;
    win.setIgnoreMouseEvents(!capture, { forward: true });
  }

  private cursorOnShape(win: BrowserWindow): boolean {
    if (!this.shape || !win.isVisible()) return false;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    return capturesPointer({ x: cursor.x - bounds.x, y: cursor.y - bounds.y }, this.shape, this.capturing);
  }

  hello(): NotchHello {
    return { state: this.state, lyrics: this.lyrics, playlists: this.playlists, settings: this.settings, cutout: this.cutout, presence: this.presence };
  }

  focusApp(): void {
    const main = this.deps.getMainWindow();
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }

  destroy(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    if (this.focusSyncTimer) clearTimeout(this.focusSyncTimer);
    this.focusSyncTimer = null;
    this.cancelLeave();
    if (this.capturePoll) clearInterval(this.capturePoll);
    this.capturePoll = null;
    this.stopRaising();
    this.detachMain();
    screen.removeListener("display-metrics-changed", this.replace);
    screen.removeListener("display-added", this.replace);
    screen.removeListener("display-removed", this.replace);
    this.listening = false;
    if (this.deps.session === "kde-wayland") void this.deps.unloadKwin();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.loaded = false;
  }

  private create(): void {
    const { width, height } = notchWindow(this.cutout);
    const win = new BrowserWindow({
      width,
      height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      ...(this.deps.session === "windows"
        ? { type: "toolbar" }
        : this.deps.session === "macos"
          ? { type: "panel", hiddenInMissionControl: true, enableLargerThanScreen: true }
          : {}),
      show: false,
      title: NOTCH_TITLE,
      icon: this.deps.icon,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        sandbox: true,
        // Without throttling Chromium leaves its input window hidden after a hide and show on Windows, and presses are lost.
        backgroundThrottling: this.deps.session === "windows",
        spellcheck: false,
      },
    });
    this.win = win;
    this.capturing = false;
    this.wantsCapture = false;
    if (clicksPassThrough(this.deps.session)) {
      win.setIgnoreMouseEvents(true, { forward: true });
      if (this.capturePoll) clearInterval(this.capturePoll);
      this.capturePoll = setInterval(() => this.syncCapture(), CAPTURE_POLL_MS);
    }
    // The title is the join key compositors use to find this window.
    win.on("page-title-updated", (event) => event.preventDefault());
    win.webContents.on("render-process-gone", (_event, details) => {
      if (win.isDestroyed()) return;
      const now = Date.now();
      this.crashTimes = this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS);
      if (this.crashTimes.length >= MAX_CRASH_RELOADS) {
        if (this.crashTimes.length === MAX_CRASH_RELOADS) {
          console.warn(`[notch] renderer gone (${details.reason}) too often, hiding the Notch`);
          this.crashTimes.push(now);
        }
        win.hide();
        return;
      }
      this.crashTimes.push(now);
      console.warn(`[notch] renderer gone (${details.reason}), reloading`);
      this.setShape(islandRect(ISLAND_SIZES.idle));
      this.setCapture(false);
      this.deps.loadPage(win).catch((error) => console.warn("[notch] reload failed:", error));
    });
    this.listenToDisplays();
    this.attachMain();
    // Set before loading, so it cannot overwrite a shape the page sends first.
    this.setShape(islandRect(ISLAND_SIZES.idle));
    this.ready = this.deps
      .loadPage(win)
      .then(() => {
        if (win.isDestroyed()) return;
        this.loaded = true;
        return this.place();
      })
      .catch((error) => console.warn("[notch] load failed:", error));
  }

  private listenToDisplays(): void {
    if (this.listening) return;
    this.listening = true;
    screen.on("display-metrics-changed", this.replace);
    screen.on("display-added", this.replace);
    screen.on("display-removed", this.replace);
  }

  private attachMain(): void {
    const main = this.deps.getMainWindow();
    if (!main || main === this.main) return;
    this.detachMain();
    this.main = main;
    main.on("move", this.onMainMove);
    main.on("enter-full-screen", this.onEnterFullscreen);
    main.on("leave-full-screen", this.onLeaveFullscreen);
    main.on("show", this.onMainVisibility);
    main.on("hide", this.onMainVisibility);
    main.on("minimize", this.onMainVisibility);
    main.on("restore", this.onMainVisibility);
    if (this.deps.session === "macos") {
      main.on("focus", this.onMainFocus);
      main.on("blur", this.onMainBlur);
    }
    this.fullscreen = main.isFullScreen();
  }

  private detachMain(): void {
    this.main?.removeListener("move", this.onMainMove);
    this.main?.removeListener("enter-full-screen", this.onEnterFullscreen);
    this.main?.removeListener("leave-full-screen", this.onLeaveFullscreen);
    this.main?.removeListener("focus", this.onMainFocus);
    this.main?.removeListener("blur", this.onMainBlur);
    this.main?.removeListener("show", this.onMainVisibility);
    this.main?.removeListener("hide", this.onMainVisibility);
    this.main?.removeListener("minimize", this.onMainVisibility);
    this.main?.removeListener("restore", this.onMainVisibility);
    this.main = null;
  }

  private mainFocusedInFullscreen(): boolean {
    const main = this.main;
    return Boolean(
      this.deps.session === "macos" && this.fullscreen && main && !main.isDestroyed() && main.isVisible() && !main.isMinimized() && main.isFocused(),
    );
  }

  private syncMacFullscreenVisibility(): void {
    if (this.deps.session !== "macos" || !this.fullscreen || !this.win || this.win.isDestroyed()) return;
    if (this.mainFocusedInFullscreen()) {
      this.win.hide();
    } else if (this.loaded && notchEnabled(this.settings.mode, this.deps.session)) {
      this.ready = this.place();
    }
  }

  private setFullscreen(value: boolean): void {
    this.fullscreen = value;
    if (!this.win || this.win.isDestroyed()) return;
    if (this.deps.session === "macos") {
      if (value) this.syncMacFullscreenVisibility();
      else if (this.loaded && notchEnabled(this.settings.mode, this.deps.session)) this.ready = this.place();
      return;
    }
    if (value) this.win.hide();
    else if (this.loaded && notchEnabled(this.settings.mode, this.deps.session)) {
      // The remap drops always-on-top on X11, so go through the full placement path.
      this.ready = this.place();
    }
  }

  private pickDisplay() {
    const { display } = this.settings;
    const main = this.deps.getMainWindow();
    if (display === "follow" && main && !main.isDestroyed()) {
      return screen.getDisplayMatching(main.getBounds());
    }
    return screen.getAllDisplays().find((candidate) => String(candidate.id) === display) ?? screen.getPrimaryDisplay();
  }

  private async place(): Promise<void> {
    const win = this.win;
    if (!win || win.isDestroyed() || !canPlaceNotch(this.deps.session)) return;
    if ((this.fullscreen && this.deps.session !== "macos") || this.settings.mode === "off") return;
    if (this.mainFocusedInFullscreen()) {
      win.hide();
      return;
    }
    if (!this.wanted()) {
      this.leave(win);
      return;
    }
    this.cancelLeave();
    const display = this.pickDisplay();
    this.placedDisplayId = display.id;
    const { position, offset } = this.settings;
    const edge = resolveEdge(this.settings.edge, this.deps.session);
    const above = this.settings.stacking === "above";
    if (this.deps.readCutout) {
      const atCamera = position === "center" && edge === "screen" && offset === 0;
      const cutout = atCamera ? await this.deps.readCutout(display.bounds).catch(() => null) : null;
      if (win.isDestroyed()) return;
      if (cutout?.width !== this.cutout?.width || cutout?.height !== this.cutout?.height) {
        this.cutout = cutout;
        this.send("notch:cutout", cutout);
      }
    }
    const size = notchWindow(this.cutout);
    const anchor = `top-${position}` as const;
    const geometry = { ...overlayOrigin(edge === "bar" ? display.workArea : display.bounds, size.width, offset, anchor), ...size };
    const session = this.deps.session;
    if (session === "x11" || clicksPassThrough(session)) {
      win.setBounds(geometry);
      win.showInactive();
      win.setAlwaysOnTop(above, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      // showing can push the frame below the menu bar; above it the panel's level holds it
      if (session === "macos") win.setBounds(geometry);
      // Mutter drops always-on-top asked for before the window is mapped, so it is asked again until it holds.
      for (let tries = 0; above && tries < ON_TOP_TRIES; tries++) {
        await new Promise((resolve) => setTimeout(resolve, ON_TOP_RETRY_MS));
        if (win.isDestroyed() || !win.isVisible() || win.isAlwaysOnTop()) break;
        win.setAlwaysOnTop(true, "screen-saver");
      }
      if (session === "windows" && above) this.keepRaising(win);
      else this.stopRaising();
    } else if (session === "kde-wayland") {
      // The script pins the window as KWin maps it, so it never shows where KWin would put it.
      const ok = await this.deps.loadKwin(kwinScript(NOTCH_TITLE, geometry, above)).catch(() => false);
      if (ok && !win.isDestroyed()) win.showInactive();
      this.recordPlacement(win, ok, "KWin script failed");
    } else {
      win.showInactive();
      const ok = await this.deps.bridge
        ?.placeOverlay({
          title: NOTCH_TITLE,
          ...size,
          anchor,
          pinned: true,
          margin: offset,
          bounds: edge === "bar" ? "workArea" : "monitor",
          display: display.bounds,
        })
        .catch(() => false);
      this.recordPlacement(win, Boolean(ok), "compositor placement failed");
    }
    if (!win.isDestroyed() && win.isVisible()) this.setPresence("in");
  }

  private wanted(): boolean {
    if (this.settings.mode !== "auto") return true;
    const main = this.main;
    return !main || main.isDestroyed() || !main.isVisible() || main.isMinimized();
  }

  private leave(win: BrowserWindow): void {
    if (this.leaveTimer || !win.isVisible()) return;
    this.setPresence("out");
    this.leaveTimer = setTimeout(() => {
      this.leaveTimer = null;
      if (win.isDestroyed() || this.wanted()) return;
      this.stopRaising();
      win.hide();
    }, LEAVE_MS);
  }

  private setPresence(presence: NotchPresence): void {
    if (presence === this.presence) return;
    this.presence = presence;
    this.send("notch:presence", presence);
  }

  private cancelLeave(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }

  // A topmost window that activates later, like a borderless game, stacks above the Notch until it is raised again.
  private keepRaising(win: BrowserWindow): void {
    this.stopRaising();
    this.raiseTimer = setInterval(() => {
      if (win.isDestroyed() || !win.isVisible()) this.stopRaising();
      else win.moveTop();
    }, RAISE_MS);
  }

  private stopRaising(): void {
    if (this.raiseTimer) clearInterval(this.raiseTimer);
    this.raiseTimer = null;
  }

  private recordPlacement(win: BrowserWindow, ok: boolean, message: string): void {
    if (!ok && !win.isDestroyed()) win.hide();
    const next = ok ? null : message;
    if (next && next !== this.placementFailure) console.warn(`[notch] ${message}`);
    this.placementFailure = next;
  }

  private send(channel: string, payload: unknown): void {
    this.webContents?.send(channel, payload);
  }
}

export function notchDisplays(): Array<{ id: `${number}`; label: string }> {
  return screen.getAllDisplays().map((display) => ({
    id: `${display.id}`,
    label: display.label || `${display.bounds.width} × ${display.bounds.height}`,
  }));
}

const MODES = ["auto", "on", "off"];
const EXPAND_ON = ["hover", "click"];
const DISPLAYS = ["follow", "primary"];
const POSITIONS = ["center", "left", "right"];
const EDGES = ["auto", "screen", "bar"];
const STACKING = ["above", "normal"];
const MAX_OFFSET = 200;

function isValidSettings(value: unknown): value is NotchSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    MODES.includes(s.mode as string) &&
    EXPAND_ON.includes(s.expandOn as string) &&
    (DISPLAYS.includes(s.display as string) || (typeof s.display === "string" && /^-?\d{1,20}$/.test(s.display))) &&
    typeof s.showLyrics === "boolean" &&
    typeof s.pulseOnTrackChange === "boolean" &&
    POSITIONS.includes(s.position as string) &&
    EDGES.includes(s.edge as string) &&
    Number.isInteger(s.offset) &&
    (s.offset as number) >= 0 &&
    (s.offset as number) <= MAX_OFFSET &&
    STACKING.includes(s.stacking as string)
  );
}

const MAX_LYRIC_LINES = 5000;
const MAX_LYRIC_TEXT = 1000;
const MAX_LINE_WORDS = 200;

const isTimedText = (value: { timeMs: number; text: string } | null) =>
  Boolean(value) && typeof value === "object" && Number.isFinite(value!.timeMs) && typeof value!.text === "string" && value!.text.length <= MAX_LYRIC_TEXT;

function isValidLyrics(value: unknown): value is NotchLyrics {
  if (!value || typeof value !== "object") return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.trackId === "string" &&
    l.trackId.length <= 256 &&
    Array.isArray(l.lines) &&
    l.lines.length <= MAX_LYRIC_LINES &&
    l.lines.every(
      (line) =>
        isTimedText(line) && (line.words === undefined || (Array.isArray(line.words) && line.words.length <= MAX_LINE_WORDS && line.words.every(isTimedText))),
    )
  );
}

const MAX_PLAYLISTS = 100;
const MAX_TEXT = 512;
const MAX_COVER_URL = 2048;
const OUTCOMES = ["added", "already", "failed"];

const isText = (value: unknown, max = MAX_TEXT) => typeof value === "string" && value.length <= max;

function isValidPlaylists(value: unknown): value is NotchPlaylists {
  if (!value || typeof value !== "object") return false;
  const { items, outcome } = value as NotchPlaylists;
  return (
    Array.isArray(items) &&
    items.length <= MAX_PLAYLISTS &&
    items.every(
      (item) =>
        item &&
        typeof item === "object" &&
        isText(item.id) &&
        isText(item.title) &&
        Number.isInteger(item.trackCount) &&
        (item.coverUrl === null || (isText(item.coverUrl, MAX_COVER_URL) && item.coverUrl.startsWith("https://"))),
    ) &&
    (outcome === null || (isText(outcome?.trackId) && isText(outcome.playlistId) && OUTCOMES.includes(outcome.kind)))
  );
}

function isValidAction(value: unknown): value is NotchAction {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  switch (a.type) {
    case "togglePlay":
    case "next":
    case "prev":
    case "like":
    case "dislike":
    case "focusApp":
      return true;
    case "seek":
      return Number.isFinite(a.positionMs);
    case "volumeDelta":
      return Number.isFinite(a.delta);
    case "playUpNext":
      return typeof a.trackId === "string";
    case "addToPlaylist":
      return typeof a.trackId === "string" && typeof a.playlistId === "string";
    default:
      return false;
  }
}

export function registerNotchIpc(notch: NotchWindow, options: { onAction: (action: NotchAction) => void; onLyrics?: (lyrics: NotchLyrics) => void }): void {
  const fromNotch = (event: { sender: unknown }) => event.sender === notch.webContents;

  ipcMain.on("notch:lyrics", (event, lyrics: NotchLyrics) => {
    if (!notch.isMainSender(event.sender) || !isValidLyrics(lyrics)) return;
    notch.setLyrics(lyrics);
    options.onLyrics?.(lyrics);
  });
  ipcMain.on("notch:playlists", (event, playlists: NotchPlaylists) => {
    if (notch.isMainSender(event.sender) && isValidPlaylists(playlists)) notch.setPlaylists(playlists);
  });
  ipcMain.on("notch:settings", (event, settings: NotchSettings) => {
    if (notch.isMainSender(event.sender) && isValidSettings(settings)) notch.applySettings(settings);
  });
  ipcMain.on("notch:action", (event, action: NotchAction) => {
    if (!fromNotch(event) || !isValidAction(action)) return;
    if (action.type === "focusApp") notch.focusApp();
    else options.onAction(action);
  });
  ipcMain.on("notch:shape", (event, rect: ShapeRect) => {
    if (fromNotch(event)) notch.setShape(rect);
  });
  ipcMain.on("notch:capture", (event, capture: boolean) => {
    if (fromNotch(event)) notch.setCapture(capture);
  });
  const onlyNotch = (event: { sender: unknown }, channel: string) => {
    if (!fromNotch(event)) throw new Error(`${channel}: sender not allowed`);
  };
  ipcMain.handle("notch:hello", (event) => {
    onlyNotch(event, "notch:hello");
    return notch.hello();
  });
  ipcMain.handle("notch:session", (event) => {
    onlyNotch(event, "notch:session");
    return { session: notch.session, supported: canPlaceNotch(notch.session), placementError: notch.placementError };
  });
}
