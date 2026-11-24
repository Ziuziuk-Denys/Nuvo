import { BrowserWindow, Menu, screen, type NativeImage } from "electron";
import type { NotchLyrics, NotchState } from "../../src/notch/contracts";
import {
  POCKET_MAX,
  POCKET_MIN,
  POCKET_SIZES,
  type PocketFace,
  type PocketFeed,
  type PocketHello,
  type PocketMenuRequest,
  type PocketSize,
  type PocketStatus,
} from "../../src/pocket/contracts";
import type { NotchSession } from "../notch/session";
import type { OverlayPlacer } from "../notch/window";
import { clampSize, kwinAboveScript, pocketBounds, pocketMargin, pocketTop, remembersPlace, type PocketPlace } from "./place";

export const POCKET_TITLE = "Nuvo Pocket";

const SAVE_DELAY_MS = 400;
const SQUARE_DELAY_MS = 120;
const ON_TOP_TRIES = 10;
const ON_TOP_RETRY_MS = 100;

export interface PocketDeps {
  preloadPath: string;
  icon?: NativeImage;
  loadPage: (win: BrowserWindow) => Promise<void>;
  session: NotchSession;
  bridge: OverlayPlacer | null;
  loadKwin: (script: string) => Promise<boolean>;
  unloadKwin: () => Promise<void>;
  onTop: () => boolean;
  setOnTop: (onTop: boolean) => void;
  place: () => PocketPlace | null;
  savePlace: (place: PocketPlace) => void;
  openApp: () => void;
  openChanged: (open: boolean) => void;
}

export class PocketWindow {
  private win: BrowserWindow | null = null;
  private state: NotchState | null = null;
  private lyrics: NotchLyrics | null = null;
  private feed: PocketFeed | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private squareTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly margin: number;

  constructor(private readonly deps: PocketDeps) {
    this.margin = pocketMargin(deps.session);
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  get webContents() {
    return this.isOpen ? this.win!.webContents : null;
  }

  status(): PocketStatus {
    const { session } = this.deps;
    return { open: this.isOpen, session, top: pocketTop(session), remembersPlace: remembersPlace(session) };
  }

  hello(): PocketHello {
    const { state, lyrics, feed, margin } = this;
    return { state, lyrics, feed, margin, top: pocketTop(this.deps.session), onTop: this.deps.onTop() };
  }

  setState(state: NotchState): void {
    this.state = state;
    this.webContents?.send("pocket:state", state);
  }

  setLyrics(lyrics: NotchLyrics): void {
    this.lyrics = lyrics;
    this.webContents?.send("pocket:lyrics", lyrics);
  }

  setFeed(feed: PocketFeed): void {
    this.feed = feed;
    this.webContents?.send("pocket:feed", feed);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  close(): void {
    if (this.isOpen) this.win!.close();
  }

  destroy(): void {
    if (this.saveTimer) this.save();
    if (this.squareTimer) clearTimeout(this.squareTimer);
    screen.removeListener("display-removed", this.keepOnScreen);
    if (this.deps.session === "kde-wayland" && this.isOpen) void this.deps.unloadKwin();
    if (this.isOpen) this.win!.destroy();
    this.win = null;
  }

  async applyOnTop(): Promise<void> {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const above = this.deps.onTop();
    const { session } = this.deps;
    if (session === "kde-wayland") {
      await this.deps.loadKwin(kwinAboveScript(POCKET_TITLE, above));
    } else if (session === "hyprland" || session === "sway") {
      const { width, height } = win.getBounds();
      await this.deps.bridge?.placeOverlay({ title: POCKET_TITLE, width, height, anchor: "top-right", pinned: above, margin: 24, bounds: "workArea" });
    } else if (pocketTop(session) === "app") {
      win.setVisibleOnAllWorkspaces(above, { visibleOnFullScreen: above, skipTransformProcessType: true });
      win.setAlwaysOnTop(above, "floating");
      // Mutter drops always-on-top asked for before the window is mapped, so it is asked again until it holds.
      for (let tries = 0; above && tries < ON_TOP_TRIES; tries++) {
        await new Promise((resolve) => setTimeout(resolve, ON_TOP_RETRY_MS));
        if (win.isDestroyed() || win.isAlwaysOnTop()) break;
        win.setAlwaysOnTop(true, "floating");
      }
    }
  }

  popMenu({ labels, face, faces }: PocketMenuRequest): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const top = pocketTop(this.deps.session);
    const show = (next: PocketFace) => this.webContents?.send("pocket:face", next);
    const sizes: PocketSize[] = ["small", "medium", "large"];
    const size = win.getBounds().width - this.margin * 2;
    Menu.buildFromTemplate([
      ...faces.map((name) => ({ label: labels[name], type: "radio" as const, checked: name === face, click: () => show(name) })),
      { type: "separator" },
      {
        label: labels.size,
        submenu: sizes.map((name) => ({
          label: labels[name],
          type: "radio" as const,
          checked: size === POCKET_SIZES[name],
          click: () => this.resize(POCKET_SIZES[name]),
        })),
      },
      ...(top === "app"
        ? [{ label: labels.onTop, type: "checkbox" as const, checked: this.deps.onTop(), click: () => this.deps.setOnTop(!this.deps.onTop()) }]
        : top === "window-menu"
          ? [{ label: labels.onTopHint, enabled: false }]
          : []),
      { type: "separator" },
      { label: labels.openApp, click: () => this.deps.openApp() },
      { label: labels.close, click: () => this.close() },
    ]).popup({ window: win });
  }

  private open(): void {
    const primary = screen.getPrimaryDisplay().workArea;
    const areas = screen.getAllDisplays().map((display) => display.workArea);
    const { session } = this.deps;
    const native = this.margin === 0;
    const side = (size: number) => size + this.margin * 2;
    const win = new BrowserWindow({
      ...pocketBounds(this.deps.place(), areas, primary, this.margin),
      minWidth: side(POCKET_MIN),
      minHeight: side(POCKET_MIN),
      maxWidth: side(POCKET_MAX),
      maxHeight: side(POCKET_MAX),
      frame: false,
      ...(native ? { backgroundColor: "#0a0a0c" } : { transparent: true, hasShadow: false }),
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      title: POCKET_TITLE,
      icon: this.deps.icon,
      webPreferences: { preload: this.deps.preloadPath, contextIsolation: true, sandbox: true, spellcheck: false },
    });
    this.win = win;
    win.setAspectRatio(1);
    // The title is the join key compositors use to find this window.
    win.on("page-title-updated", (event) => event.preventDefault());
    win.on("move", () => this.saveSoon());
    win.on("resize", () => {
      this.saveSoon();
      if (this.squareTimer) clearTimeout(this.squareTimer);
      this.squareTimer = setTimeout(() => this.square(), SQUARE_DELAY_MS);
    });
    win.on("system-context-menu", (event) => {
      event.preventDefault();
      this.webContents?.send("pocket:context");
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.warn(`[pocket] renderer gone (${details.reason})`);
      this.destroy();
      this.deps.openChanged(false);
    });
    win.on("close", () => {
      if (this.saveTimer) this.save();
    });
    win.on("closed", () => {
      this.win = null;
      this.destroy();
      if (session === "kde-wayland") void this.deps.unloadKwin();
      this.deps.openChanged(false);
    });
    screen.on("display-removed", this.keepOnScreen);
    win.once("ready-to-show", () => {
      win.show();
      void this.applyOnTop();
    });
    this.deps.loadPage(win).catch((error) => console.warn("[pocket] load failed:", error));
    this.deps.openChanged(true);
  }

  private resize(size: number): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const from = win.getBounds();
    const side = clampSize(size) + this.margin * 2;
    const area = screen.getDisplayMatching(from).workArea;
    const right = from.x + from.width / 2 > area.x + area.width / 2;
    const low = from.y + from.height / 2 > area.y + area.height / 2;
    win.setBounds({ x: right ? from.x + from.width - side : from.x, y: low ? from.y + from.height - side : from.y, width: side, height: side });
  }

  private square(): void {
    this.squareTimer = null;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const { width, height } = win.getBounds();
    if (width !== height) win.setSize(Math.max(width, height), Math.max(width, height));
  }

  private readonly keepOnScreen = () => {
    const win = this.win;
    if (!win || win.isDestroyed() || !remembersPlace(this.deps.session)) return;
    const areas = screen.getAllDisplays().map((display) => display.workArea);
    win.setBounds(pocketBounds(this.current(win), areas, screen.getPrimaryDisplay().workArea, this.margin));
  };

  private current(win: BrowserWindow): PocketPlace {
    const { x, y, width } = win.getBounds();
    const size = clampSize(width - this.margin * 2);
    return remembersPlace(this.deps.session) ? { size, x: x + this.margin, y: y + this.margin } : { size };
  }

  private saveSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.win && !this.win.isDestroyed()) this.deps.savePlace(this.current(this.win));
  }
}
