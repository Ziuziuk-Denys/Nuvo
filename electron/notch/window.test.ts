import { describe, expect, it, vi, afterEach } from "vitest";

const electron = vi.hoisted(() => {
  const { EventEmitter } = require("node:events") as typeof import("node:events");
  const ipcOn = new Map<string, (...args: any[]) => unknown>();
  const ipcHandle = new Map<string, (...args: any[]) => unknown>();
  const windows: FakeWindow[] = [];
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const screenEvents = new EventEmitter();

  class FakeWindow extends EventEmitter {
    calls: Array<[string, ...unknown[]]> = [];
    destroyed = false;
    options: any;
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
    constructor(options: any = {}) {
      super();
      this.options = options;
      windows.push(this);
    }
    private rec(name: string, ...args: unknown[]) {
      this.calls.push([name, ...args]);
    }
    setBounds(b: unknown) {
      this.rec("setBounds", b);
    }
    showInactive() {
      this.rec("showInactive");
    }
    hide() {
      this.rec("hide");
    }
    setAlwaysOnTop(...a: unknown[]) {
      this.rec("setAlwaysOnTop", ...a);
    }
    setVisibleOnAllWorkspaces(...a: unknown[]) {
      this.rec("setVisibleOnAllWorkspaces", ...a);
    }
    setShape(r: unknown) {
      this.rec("setShape", r);
    }
    setIgnoreMouseEvents(...a: unknown[]) {
      this.rec("setIgnoreMouseEvents", ...a);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.rec("destroy");
    }
    restore = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    isMinimized = () => true;
    isVisible = () => true;
    isAlwaysOnTop = () => this.calls.some((c) => c[0] === "setAlwaysOnTop");
    fullscreen = false;
    isFullScreen = () => this.fullscreen;
    getBounds = () => ({ x: 100, y: 100, width: 800, height: 600 });
  }

  return {
    ipcOn,
    ipcHandle,
    windows,
    display,
    screenEvents,
    module: {
      BrowserWindow: FakeWindow,
      ipcMain: {
        on: (c: string, h: (...a: any[]) => unknown) => ipcOn.set(c, h),
        handle: (c: string, h: (...a: any[]) => unknown) => ipcHandle.set(c, h),
      },
      screen: {
        getPrimaryDisplay: vi.fn(() => display),
        getDisplayMatching: vi.fn(() => display),
        getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 900 })),
        on: (e: string, h: () => void) => screenEvents.on(e, h),
        removeListener: (e: string, h: () => void) => screenEvents.removeListener(e, h),
      },
    },
  };
});

vi.mock("electron", () => electron.module);
import { DEFAULT_NOTCH_SETTINGS as OFF_BY_DEFAULT, type NotchState } from "../../src/notch/contracts";
import { ISLAND_SIZES, islandRect } from "../../src/notch/lib/geometry";
import type { NotchSession } from "./session";
import { NOTCH_TITLE, NotchWindow, registerNotchIpc } from "./window";

const DEFAULT_NOTCH_SETTINGS = { ...OFF_BY_DEFAULT, mode: "auto" as const };

type FakeWin = InstanceType<typeof electron.module.BrowserWindow>;
const lastWindow = () => electron.windows.at(-1)!;
const names = (win: FakeWin) => win.calls.map((c) => c[0]);

function createNotch(opts: { session: NotchSession; main?: FakeWin | null; bridge?: any; loadKwin?: any; apply?: boolean }) {
  const main = opts.main === undefined ? new electron.module.BrowserWindow() : opts.main;
  const deps = {
    preloadPath: "/preload.js",
    loadPage: vi.fn(async () => {}),
    session: opts.session,
    bridge: opts.bridge ?? null,
    loadKwin: opts.loadKwin ?? vi.fn(async () => true),
    unloadKwin: vi.fn(async () => {}),
    getMainWindow: () => main as any,
  };
  const notch = new NotchWindow(deps);
  if (opts.apply !== false) notch.applySettings(DEFAULT_NOTCH_SETTINGS);
  return { notch, deps, main: main as FakeWin };
}

const state: NotchState = { track: null, status: "idle", positionMs: 0, sampledAt: 0, liked: false, upNext: [] };

afterEach(() => {
  electron.windows.length = 0;
  electron.ipcOn.clear();
  electron.ipcHandle.clear();
  electron.screenEvents.removeAllListeners();
  vi.useRealTimers();
  electron.module.screen.getDisplayMatching.mockImplementation(() => electron.display);
  electron.module.screen.getCursorScreenPoint.mockImplementation(() => ({ x: 0, y: 900 }));
});

describe("NotchWindow", () => {
  it("creates no window on GNOME Wayland in auto mode", () => {
    createNotch({ session: "gnome-wayland" });
    expect(electron.windows.filter((w) => w.options.title === NOTCH_TITLE)).toHaveLength(0);
  });

  it("creates the window only when settings arrive", async () => {
    const { notch } = createNotch({ session: "x11", apply: false });
    expect(notch.hello().settings).toEqual(OFF_BY_DEFAULT);
    expect(electron.windows.filter((w) => w.options.title === NOTCH_TITLE)).toHaveLength(0);
    notch.applySettings({ ...DEFAULT_NOTCH_SETTINGS, mode: "off" });
    expect(electron.windows.filter((w) => w.options.title === NOTCH_TITLE)).toHaveLength(0);
    notch.applySettings(DEFAULT_NOTCH_SETTINGS);
    await notch.ready;
    expect(names(lastWindow())).toContain("showInactive");
  });

  it("destroys the window on mode off and re-creates it when switched back on", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    const win = lastWindow();
    notch.applySettings({ ...DEFAULT_NOTCH_SETTINGS, mode: "off" });
    expect(win.destroyed).toBe(true);
    expect(notch.webContents).toBeNull();
    notch.applySettings(DEFAULT_NOTCH_SETTINGS);
    await notch.ready;
    expect(lastWindow()).not.toBe(win);
    expect(names(lastWindow())).toContain("showInactive");
  });

  it("uses the pinned transparent window options and keeps the title fixed", () => {
    createNotch({ session: "x11" });
    const win = lastWindow();
    expect(win.options).toMatchObject({
      width: 496,
      height: 200,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      title: "Nuvo Notch",
      webPreferences: { preload: "/preload.js", contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    const event = { preventDefault: vi.fn() };
    win.emit("page-title-updated", event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("pins on X11 after showing, so always-on-top survives mapping", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    const win = lastWindow();
    const order = names(win);
    expect(order.indexOf("showInactive")).toBeLessThan(order.indexOf("setAlwaysOnTop"));
    expect(win.calls.find((c) => c[0] === "setBounds")![1]).toEqual({ x: 712, y: 0, width: 496, height: 200 });
    expect(win.calls.find((c) => c[0] === "setAlwaysOnTop")!.slice(1)).toEqual([true, "screen-saver"]);
    expect(win.calls.find((c) => c[0] === "setVisibleOnAllWorkspaces")!.slice(1)).toEqual([
      true,
      { visibleOnFullScreen: true, skipTransformProcessType: true },
    ]);
  });

  it("places through the compositor bridge on Hyprland and Sway", async () => {
    const bridge = { placeOverlay: vi.fn(async () => true) };
    const { notch } = createNotch({ session: "hyprland", bridge });
    await notch.ready;
    expect(bridge.placeOverlay).toHaveBeenCalledWith({
      title: "Nuvo Notch",
      width: 496,
      height: 200,
      anchor: "top-center",
      pinned: true,
      margin: 0,
      bounds: "monitor",
    });
    expect(names(lastWindow()).indexOf("showInactive")).toBeGreaterThanOrEqual(0);
  });

  it("loads a KWin script on KDE", async () => {
    const loadKwin = vi.fn(async () => true);
    const { notch } = createNotch({ session: "kde-wayland", loadKwin });
    await notch.ready;
    expect(loadKwin).toHaveBeenCalledTimes(1);
    const script = (loadKwin.mock.calls[0] as unknown as [string])[0];
    expect(script).toContain('"Nuvo Notch"');
    expect(script).toContain('"x":712');
  });

  it("records a placement error from a failing bridge or KWin and clears it on success", async () => {
    const bridge = { placeOverlay: vi.fn(async () => false) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { notch } = createNotch({ session: "sway", bridge });
    await notch.ready;
    expect(notch.placementError).toBe("compositor placement failed");
    bridge.placeOverlay.mockResolvedValueOnce(true);
    notch.applySettings({ ...DEFAULT_NOTCH_SETTINGS, display: "primary" });
    await notch.ready;
    expect(notch.placementError).toBeNull();

    const loadKwin = vi.fn(async () => false);
    const kde = createNotch({ session: "kde-wayland", loadKwin });
    await kde.notch.ready;
    expect(kde.notch.placementError).toBe("KWin script failed");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("picks the display of the main window when following, else the primary", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    expect(electron.module.screen.getDisplayMatching).toHaveBeenCalledWith({ x: 100, y: 100, width: 800, height: 600 });
    electron.module.screen.getPrimaryDisplay.mockClear();
    notch.applySettings({ ...DEFAULT_NOTCH_SETTINGS, display: "primary" });
    expect(electron.module.screen.getPrimaryDisplay).toHaveBeenCalled();
  });

  it("re-places on display changes and when the main window settles on another display", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    const win = lastWindow();
    const count = () => names(win).filter((n) => n === "setBounds").length;
    expect(count()).toBe(1);
    for (const event of ["display-metrics-changed", "display-added", "display-removed"]) {
      electron.screenEvents.emit(event);
    }
    await vi.waitFor(() => expect(count()).toBe(4));
    vi.useFakeTimers();
    main.emit("move");
    vi.advanceTimersByTime(300);
    expect(count()).toBe(4);
    const other = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
    electron.module.screen.getDisplayMatching.mockImplementation(() => other);
    main.emit("move");
    vi.advanceTimersByTime(100);
    main.emit("move");
    vi.advanceTimersByTime(299);
    expect(count()).toBe(4);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(count()).toBe(5));
    expect(win.calls.filter((c) => c[0] === "setBounds").at(-1)![1]).toEqual({ x: 2632, y: 0, width: 496, height: 200 });
  });

  it("does not place a window that stays hidden, and places it when shown", async () => {
    const main = new electron.module.BrowserWindow();
    main.fullscreen = true;
    const { notch } = createNotch({ session: "x11", main });
    await notch.ready;
    const win = lastWindow();
    expect(names(win)).not.toContain("setBounds");
    expect(names(win)).not.toContain("showInactive");
    main.emit("leave-full-screen");
    await notch.ready;
    expect(names(win)).toContain("setBounds");
    expect(names(win)).toContain("showInactive");
  });

  it("sets the idle shape before the page loads", () => {
    const { deps } = createNotch({ session: "x11", apply: false });
    let shapedBeforeLoad = false;
    deps.loadPage.mockImplementation(async () => {
      shapedBeforeLoad = names(lastWindow()).includes("setShape");
    });
    new NotchWindow(deps).applySettings(DEFAULT_NOTCH_SETTINGS);
    expect(shapedBeforeLoad).toBe(true);
  });

  it("reloads the page with the idle shape when its renderer is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { notch, deps } = createNotch({ session: "x11" });
    await notch.ready;
    notch.setShape({ x: 0, y: 0, width: 500, height: 200 });
    lastWindow().webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(deps.loadPage).toHaveBeenCalledTimes(2);
    expect(notch.lastShape).toEqual({ x: 132, y: 0, width: 232, height: 34 });
    warn.mockRestore();
  });

  it("stops reloading after 3 renderer crashes in 60 s, hides and logs once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { notch, deps } = createNotch({ session: "x11" });
    await notch.ready;
    vi.useFakeTimers();
    const crash = () => lastWindow().webContents.emit("render-process-gone", {}, { reason: "crashed" });
    for (let i = 0; i < 3; i++) crash();
    expect(deps.loadPage).toHaveBeenCalledTimes(4);
    crash();
    crash();
    expect(deps.loadPage).toHaveBeenCalledTimes(4);
    expect(names(lastWindow()).at(-1)).toBe("hide");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("too often"))).toHaveLength(1);
    vi.advanceTimersByTime(61_000);
    crash();
    expect(deps.loadPage).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it("on Windows and macOS ignores the mouse until the renderer asks, and never sets a shape", async () => {
    for (const [session, type] of [
      ["windows", "toolbar"],
      ["macos", "panel"],
    ] as const) {
      const { notch } = createNotch({ session });
      await notch.ready;
      const win = lastWindow();
      expect(win.options).toMatchObject({ type, focusable: false, skipTaskbar: true, width: 496, height: 200 });
      const ignores = () => win.calls.filter((c) => c[0] === "setIgnoreMouseEvents").map((c) => c.slice(1));
      expect(ignores()).toEqual([[true, { forward: true }]]);
      expect(names(win)).not.toContain("setShape");
      expect(names(win)).toContain("showInactive");
      expect(win.calls.find((c) => c[0] === "setBounds")![1]).toEqual({ x: 712, y: 0, width: 496, height: 200 });
      notch.setCapture(true);
      expect(notch.capturesMouse).toBe(true);
      notch.setShape({ x: 0, y: 0, width: 50, height: 20 });
      win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
      expect(notch.capturesMouse).toBe(false);
      expect(ignores()).toEqual([
        [true, { forward: true }],
        [false, { forward: true }],
        [true, { forward: true }],
      ]);
      expect(names(win)).not.toContain("setShape");
      notch.destroy();
    }
  });

  it("on Windows takes the mouse while the cursor is on the island, whatever the renderer last said", async () => {
    vi.useFakeTimers();
    const { notch } = createNotch({ session: "windows" });
    await vi.advanceTimersByTimeAsync(200);
    await notch.ready;
    const win = lastWindow();
    win.getBounds = () => ({ x: 712, y: 0, width: 496, height: 200 });
    const pill = islandRect(ISLAND_SIZES.idle);
    const onPill = { x: 712 + pill.x + pill.width / 2, y: pill.y + pill.height / 2 };
    const ignores = () => win.calls.filter((c) => c[0] === "setIgnoreMouseEvents").map((c) => c[1]);

    electron.module.screen.getCursorScreenPoint.mockImplementation(() => onPill);
    await vi.advanceTimersByTimeAsync(150);
    expect(notch.capturesMouse).toBe(true);

    notch.setCapture(true);
    notch.setCapture(false);
    expect(notch.capturesMouse).toBe(true);

    electron.module.screen.getCursorScreenPoint.mockImplementation(() => ({ x: 0, y: 900 }));
    await vi.advanceTimersByTimeAsync(150);
    expect(notch.capturesMouse).toBe(false);
    expect(ignores()).toEqual([true, false, true]);

    notch.destroy();
    await vi.advanceTimersByTimeAsync(500);
    expect(ignores()).toEqual([true, false, true]);
  });

  it("asks for always-on-top again until the window manager keeps it", async () => {
    vi.useFakeTimers();
    const { notch } = createNotch({ session: "x11", apply: false });
    notch.applySettings(DEFAULT_NOTCH_SETTINGS);
    const win = lastWindow();
    let checks = 0;
    win.isAlwaysOnTop = () => ++checks > 3;
    await vi.advanceTimersByTimeAsync(1_000);
    await notch.ready;
    expect(win.calls.filter((c) => c[0] === "setAlwaysOnTop")).toHaveLength(4);
  });

  it("keeps the input shape on Linux and ignores capture requests there", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    notch.setCapture(true);
    expect(notch.capturesMouse).toBe(false);
    expect(names(lastWindow())).not.toContain("setIgnoreMouseEvents");
    expect(lastWindow().options.type).toBeUndefined();
  });

  it("starts with the idle shape and clamps later shapes", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    const shapes = () =>
      lastWindow()
        .calls.filter((c) => c[0] === "setShape")
        .map((c) => c[1]);
    expect(shapes()[0]).toEqual([{ x: 132, y: 0, width: 232, height: 34 }]);
    notch.setShape({ x: -10, y: 0, width: 900, height: 34.6 });
    notch.setShape({ x: Number.NaN, y: 0, width: 10, height: 10 });
    expect(shapes().at(-1)).toEqual([{ x: 0, y: 0, width: 496, height: 35 }]);
    expect(shapes()).toHaveLength(2);
    expect(notch.lastShape).toEqual({ x: 0, y: 0, width: 496, height: 35 });
  });

  it("hides while the main window is fullscreen and shows again after", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    const win = lastWindow();
    main.emit("enter-full-screen");
    expect(names(win).at(-1)).toBe("hide");
    main.emit("leave-full-screen");
    await notch.ready;
    const after = names(win).slice(names(win).lastIndexOf("hide"));
    expect(after.indexOf("showInactive")).toBeGreaterThanOrEqual(0);
    expect(after.indexOf("setAlwaysOnTop")).toBeGreaterThan(after.indexOf("showInactive"));
    expect(after).toContain("setVisibleOnAllWorkspaces");
  });

  it("remembers state and lyrics, forwards them and answers hello", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    const win = lastWindow();
    const lyrics = { trackId: "a", lines: [] };
    notch.setState(state);
    notch.setLyrics(lyrics);
    notch.applySettings({ ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" });
    expect(win.webContents.send).toHaveBeenCalledWith("notch:state", state);
    expect(win.webContents.send).toHaveBeenCalledWith("notch:lyrics", lyrics);
    expect(win.webContents.send).toHaveBeenCalledWith("notch:settings", { ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" });
    expect(notch.hello()).toEqual({ state, lyrics, settings: { ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" } });
  });

  it("focusApp restores, shows and focuses the main window", () => {
    const { notch, main } = createNotch({ session: "x11" });
    notch.focusApp();
    expect(main.restore).toHaveBeenCalled();
    expect(main.show).toHaveBeenCalled();
    expect(main.focus).toHaveBeenCalled();
  });

  it("unloads the KWin script on destroy only on KDE", async () => {
    const kde = createNotch({ session: "kde-wayland" });
    await kde.notch.ready;
    kde.notch.destroy();
    expect(kde.deps.unloadKwin).toHaveBeenCalledTimes(1);
    const x11 = createNotch({ session: "x11" });
    x11.notch.destroy();
    expect(x11.deps.unloadKwin).not.toHaveBeenCalled();
  });

  it("destroy removes listeners and destroys the window", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    notch.destroy();
    expect(lastWindow().destroyed).toBe(true);
    expect(main.listenerCount("move")).toBe(0);
    expect(main.listenerCount("enter-full-screen")).toBe(0);
    expect(electron.screenEvents.listenerCount("display-added")).toBe(0);
  });
});

describe("registerNotchIpc", () => {
  it("hands notch actions to onAction, from the Notch only", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    const onAction = vi.fn();
    registerNotchIpc(notch, { onAction });
    const notchSender = lastWindow().webContents;

    electron.ipcOn.get("notch:action")!({ sender: notchSender }, { type: "next" });
    expect(onAction).toHaveBeenCalledWith({ type: "next" });

    electron.ipcOn.get("notch:action")!({ sender: {} }, { type: "prev" });
    expect(onAction).toHaveBeenCalledTimes(1);

    electron.ipcOn.get("notch:action")!({ sender: notchSender }, { type: "focusApp" });
    expect(main.focus).toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledTimes(1);

    electron.ipcOn.get("notch:shape")!({ sender: notchSender }, { x: 0, y: 0, width: 50, height: 20 });
    expect(notch.lastShape).toEqual({ x: 0, y: 0, width: 50, height: 20 });

    const capture = vi.spyOn(notch, "setCapture");
    electron.ipcOn.get("notch:capture")!({ sender: main.webContents }, true);
    expect(capture).not.toHaveBeenCalled();
    electron.ipcOn.get("notch:capture")!({ sender: notchSender }, true);
    expect(capture).toHaveBeenCalledWith(true);

    expect(electron.ipcHandle.get("notch:hello")!({ sender: notchSender })).toEqual(notch.hello());
    expect(electron.ipcHandle.get("notch:session")!({ sender: notchSender })).toEqual({ session: "x11", supported: true, placementError: null });
  });

  it("accepts lyrics only from the main window", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    registerNotchIpc(notch, { onAction: vi.fn() });
    const lyrics = { trackId: "t", lines: [{ timeMs: 0, text: "a" }] };

    electron.ipcOn.get("notch:lyrics")!({ sender: {} }, lyrics);
    electron.ipcOn.get("notch:lyrics")!({ sender: lastWindow().webContents }, lyrics);
    expect(notch.hello().lyrics).toBeNull();

    electron.ipcOn.get("notch:lyrics")!({ sender: main.webContents }, lyrics);
    expect(notch.hello().lyrics).toEqual(lyrics);
  });

  it("ignores malformed actions and settings", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    const onAction = vi.fn();
    registerNotchIpc(notch, { onAction });
    const sender = lastWindow().webContents;
    const action = electron.ipcOn.get("notch:action")!;
    for (const bad of [null, "x", {}, { type: "nope" }, { type: "seek", positionMs: Number.NaN }, { type: "volumeDelta", delta: "1" }]) {
      action({ sender }, bad);
    }
    expect(onAction).not.toHaveBeenCalled();
    action({ sender }, { type: "seek", positionMs: 5 });
    expect(onAction).toHaveBeenCalledTimes(1);
    const settings = electron.ipcOn.get("notch:settings")!;
    const fromMain = { sender: main.webContents };
    settings(fromMain, { ...DEFAULT_NOTCH_SETTINGS, mode: "bogus" });
    settings(fromMain, { ...DEFAULT_NOTCH_SETTINGS, showLyrics: "yes" });
    settings(fromMain, { ...DEFAULT_NOTCH_SETTINGS, pulseOnTrackChange: 1 });
    settings(fromMain, null);
    settings({ sender: {} }, { ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" });
    settings({ sender }, { ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" });
    expect(notch.hello().settings).toEqual(DEFAULT_NOTCH_SETTINGS);
    settings(fromMain, { ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" });
    expect(notch.hello().settings).toEqual({ ...DEFAULT_NOTCH_SETTINGS, expandOn: "click" });
  });

  it("answers notch:hello and notch:session for the Notch only", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    registerNotchIpc(notch, { onAction: vi.fn() });
    for (const channel of ["notch:hello", "notch:session"]) {
      expect(() => electron.ipcHandle.get(channel)!({ sender: main.webContents })).toThrow();
      expect(() => electron.ipcHandle.get(channel)!({ sender: {} })).toThrow();
      expect(() => electron.ipcHandle.get(channel)!({ sender: lastWindow().webContents })).not.toThrow();
    }
  });

  it("the new main retires notch:state: its state comes from the relay", async () => {
    const { notch } = createNotch({ session: "x11" });
    await notch.ready;
    registerNotchIpc(notch, { onAction: vi.fn() });
    expect(electron.ipcOn.has("notch:state")).toBe(false);
  });

  it("refuses malformed lyrics and tolerates a null shape", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    registerNotchIpc(notch, { onAction: vi.fn() });
    const lyrics = electron.ipcOn.get("notch:lyrics")!;
    const fromMain = { sender: main.webContents };
    for (const bad of [
      null,
      "x",
      { trackId: 1, lines: [] },
      { trackId: "t", lines: "a" },
      { trackId: "t", lines: [{ timeMs: "0", text: "a" }] },
      { trackId: "t", lines: [{ timeMs: Number.NaN, text: "a" }] },
      { trackId: "t", lines: [{ timeMs: 0, text: 5 }] },
    ]) {
      lyrics(fromMain, bad);
    }
    expect(notch.hello().lyrics).toBeNull();
    lyrics(fromMain, { trackId: "t", lines: [{ timeMs: 0, text: "a" }] });
    expect(notch.hello().lyrics).toEqual({ trackId: "t", lines: [{ timeMs: 0, text: "a" }] });
    const shape = electron.ipcOn.get("notch:shape")!;
    expect(() => shape({ sender: lastWindow().webContents }, null)).not.toThrow();
    expect(() => shape({ sender: lastWindow().webContents }, "x")).not.toThrow();
  });

  it("hands actions to onAction when given; focusApp stays a window action", async () => {
    const { notch, main } = createNotch({ session: "x11" });
    await notch.ready;
    const onAction = vi.fn();
    registerNotchIpc(notch, { onAction });
    const sender = lastWindow().webContents;
    const mainSend = vi.fn();
    (main as any).webContents = { send: mainSend };
    const action = electron.ipcOn.get("notch:action")!;
    action({ sender }, { type: "next" });
    action({ sender: {} }, { type: "prev" });
    action({ sender }, { type: "focusApp" });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: "next" });
    expect(main.focus).toHaveBeenCalled();
    expect(mainSend).not.toHaveBeenCalled();
  });
});
