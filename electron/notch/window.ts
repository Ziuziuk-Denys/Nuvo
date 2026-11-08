import { BrowserWindow, ipcMain, screen, type NativeImage } from "electron";
import {
  DEFAULT_NOTCH_SETTINGS,
  type NotchAction,
  type NotchHello,
  type NotchLyrics,
  type NotchSettings,
  type NotchState,
  type ShapeRect,
} from "../../src/notch/contracts";
import { ISLAND_SIZES, NOTCH_WINDOW, islandRect } from "../../src/notch/lib/geometry";
import { kwinScript, notchOrigin } from "./placement";
import { canPlaceNotch, notchEnabled, type NotchSession } from "./session";

export const NOTCH_TITLE = "Nuvo Notch";

/** What placement needs from a compositor bridge (Hyprland and sway); both mains pass one of these. */
export interface OverlayPlacer {
  placeOverlay(request: {
    title: string;
    width: number;
    height: number;
    anchor: "top-left" | "top-center" | "top-right";
    pinned: boolean;
    margin: number;
    /** "monitor": the full output, the same origin notchOrigin gives X11 and KWin. */
    bounds?: "monitor" | "workArea";
  }): Promise<boolean>;
}
const { width: WIDTH, height: HEIGHT } = NOTCH_WINDOW;
const MOVE_SETTLE_MS = 300;
const MAX_CRASH_RELOADS = 3;
const CRASH_WINDOW_MS = 60_000;

export interface NotchDeps {
  preloadPath: string;
  /** The app icon, so a desktop that shows this window anywhere shows Nuvo's. */
  icon?: NativeImage;
  loadPage: (win: BrowserWindow) => Promise<void>;
  session: NotchSession;
  bridge: OverlayPlacer | null;
  loadKwin: (script: string) => Promise<boolean>;
  unloadKwin: () => Promise<void>;
  getMainWindow: () => BrowserWindow | null;
}

export class NotchWindow {
  /** Resolves after the first placement; replaced when the window is created later. */
  ready: Promise<void> = Promise.resolve();

  private win: BrowserWindow | null = null;
  private main: BrowserWindow | null = null;
  private settings = DEFAULT_NOTCH_SETTINGS;
  private state: NotchState | null = null;
  private lyrics: NotchLyrics | null = null;
  private shape: ShapeRect | null = null;
  private loaded = false;
  private placementFailure: string | null = null;
  private listening = false;
  private fullscreen = false;
  private placedDisplayId: number | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly replace = () => void this.place();
  // Moving the main window within its display changes nothing; only a display switch re-places.
  private readonly replaceIfDisplayChanged = () => {
    if (this.pickDisplay().id !== this.placedDisplayId) this.replace();
  };
  private readonly onEnterFullscreen = () => this.setFullscreen(true);
  private readonly onLeaveFullscreen = () => this.setFullscreen(false);
  private readonly onMainMove = () => {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(this.replaceIfDisplayChanged, MOVE_SETTLE_MS);
  };

  private crashTimes: number[] = [];

  constructor(private readonly deps: NotchDeps) {}

  get lastShape(): ShapeRect | null {
    return this.shape;
  }

  get session(): NotchSession {
    return this.deps.session;
  }

  /** Last placement failure (bridge or KWin), null when placement worked. */
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
      // a hidden window still holds a renderer process; it is re-created when enabled again
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

  setShape(rect: ShapeRect): void {
    if (!rect || typeof rect !== "object") return;
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every(Number.isFinite)) return;
    const left = Math.max(0, Math.round(rect.x));
    const top = Math.max(0, Math.round(rect.y));
    const width = Math.min(WIDTH, Math.round(rect.x + rect.width)) - left;
    const height = Math.min(HEIGHT, Math.round(rect.y + rect.height)) - top;
    if (width <= 0 || height <= 0) return;
    this.shape = { x: left, y: top, width, height };
    if (this.win && !this.win.isDestroyed()) this.win.setShape([this.shape]);
  }

  hello(): NotchHello {
    return { state: this.state, lyrics: this.lyrics, settings: this.settings };
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
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      title: NOTCH_TITLE,
      icon: this.deps.icon,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.win = win;
    // The title is the join key compositors use to find this window.
    win.on("page-title-updated", (event) => event.preventDefault());
    win.webContents.on("render-process-gone", (_event, details) => {
      if (win.isDestroyed()) return;
      const now = Date.now();
      this.crashTimes = this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS);
      if (this.crashTimes.length >= MAX_CRASH_RELOADS) {
        // Crash loop: stop reloading. Logged on the first refusal only.
        if (this.crashTimes.length === MAX_CRASH_RELOADS) {
          console.warn(`[notch] renderer gone (${details.reason}) too often, hiding the Notch`);
          this.crashTimes.push(now);
        }
        win.hide();
        return;
      }
      this.crashTimes.push(now);
      console.warn(`[notch] renderer gone (${details.reason}), reloading`);
      // The fresh page starts idle and asks for state with notch:hello.
      this.setShape(islandRect(ISLAND_SIZES.idle));
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
    this.fullscreen = main.isFullScreen();
  }

  private detachMain(): void {
    this.main?.removeListener("move", this.onMainMove);
    this.main?.removeListener("enter-full-screen", this.onEnterFullscreen);
    this.main?.removeListener("leave-full-screen", this.onLeaveFullscreen);
    this.main = null;
  }

  private setFullscreen(value: boolean): void {
    this.fullscreen = value;
    if (!this.win || this.win.isDestroyed()) return;
    if (value) this.win.hide();
    else if (this.loaded && notchEnabled(this.settings.mode, this.deps.session)) {
      // The remap drops always-on-top on X11, so go through the full placement path.
      this.ready = this.place();
    }
  }

  private pickDisplay() {
    const main = this.deps.getMainWindow();
    if (this.settings.display === "follow" && main && !main.isDestroyed()) {
      return screen.getDisplayMatching(main.getBounds());
    }
    return screen.getPrimaryDisplay();
  }

  private async place(): Promise<void> {
    const win = this.win;
    if (!win || win.isDestroyed() || !canPlaceNotch(this.deps.session)) return;
    // Hidden windows are placed again when they are shown (mode on, fullscreen left).
    if (this.fullscreen || this.settings.mode === "off") return;
    const display = this.pickDisplay();
    this.placedDisplayId = display.id;
    const geometry = { ...notchOrigin(display.bounds, WIDTH), width: WIDTH, height: HEIGHT };
    const session = this.deps.session;
    if (session === "x11") {
      win.setBounds(geometry);
      win.showInactive();
      // Always-on-top set before the window is mapped is lost on Mutter, so it follows showInactive.
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } else if (session === "kde-wayland") {
      win.showInactive();
      const ok = await this.deps.loadKwin(kwinScript(NOTCH_TITLE, geometry)).catch(() => false);
      this.recordPlacement(ok, "KWin script failed");
    } else {
      win.showInactive();
      const ok = await this.deps.bridge
        ?.placeOverlay({
          title: NOTCH_TITLE,
          width: WIDTH,
          height: HEIGHT,
          anchor: "top-center",
          pinned: true,
          margin: 0,
          bounds: "monitor",
        })
        .catch(() => false);
      this.recordPlacement(Boolean(ok), "compositor placement failed");
    }
  }

  // Logged once per distinct failure; the window stays wherever the compositor put it.
  private recordPlacement(ok: boolean, message: string): void {
    const next = ok ? null : message;
    if (next && next !== this.placementFailure) console.warn(`[notch] ${message}`);
    this.placementFailure = next;
  }

  private send(channel: string, payload: unknown): void {
    this.webContents?.send(channel, payload);
  }
}

const MODES = ["auto", "on", "off"];
const EXPAND_ON = ["hover", "click"];
const DISPLAYS = ["follow", "primary"];

function isValidSettings(value: unknown): value is NotchSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    MODES.includes(s.mode as string) &&
    EXPAND_ON.includes(s.expandOn as string) &&
    DISPLAYS.includes(s.display as string) &&
    typeof s.showLyrics === "boolean" &&
    typeof s.pulseOnTrackChange === "boolean"
  );
}

const MAX_LYRIC_LINES = 5000;
const MAX_LYRIC_TEXT = 1000;

function isValidLyrics(value: unknown): value is NotchLyrics {
  if (!value || typeof value !== "object") return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.trackId === "string" &&
    l.trackId.length <= 256 &&
    Array.isArray(l.lines) &&
    l.lines.length <= MAX_LYRIC_LINES &&
    l.lines.every(
      (line) => line && typeof line === "object" && Number.isFinite(line.timeMs) && typeof line.text === "string" && line.text.length <= MAX_LYRIC_TEXT,
    )
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
    case "focusApp":
      return true;
    case "seek":
      return Number.isFinite(a.positionMs);
    case "volumeDelta":
      return Number.isFinite(a.delta);
    case "playUpNext":
      return typeof a.trackId === "string";
    default:
      return false;
  }
}

/** `onAction` turns Notch actions into player commands; the Notch's state comes from main's player relay. `onLyrics` shares the lyrics with the panel widget bus. */
export function registerNotchIpc(notch: NotchWindow, options: { onAction: (action: NotchAction) => void; onLyrics?: (lyrics: NotchLyrics) => void }): void {
  const fromNotch = (event: { sender: unknown }) => event.sender === notch.webContents;

  ipcMain.on("notch:lyrics", (event, lyrics: NotchLyrics) => {
    if (!notch.isMainSender(event.sender) || !isValidLyrics(lyrics)) return;
    notch.setLyrics(lyrics);
    options.onLyrics?.(lyrics);
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
