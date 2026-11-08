import { EventEmitter } from "node:events";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { findLinkArg } from "./deeplink";
import { chromiumUsage, CrashPolicy, DAEMON_BUDGET_MS, IconInstaller, revealTarget, Shutdown, SleepBlocker, WATCHDOG_MS } from "./lifecycle";
import {
  APP_ID,
  applySwitches,
  crashRecovery,
  guardContents,
  restoreBounds,
  keepUserData,
  MainWindowController,
  onSecondInstance,
  takeInstanceLock,
  type AppLike,
  type WindowLike,
} from "./mainWindow";
import { PlayerRelay } from "./relay";
import { dragBounds, onScreenBounds, restoreUnderCursor } from "./windowRules";

class FakeWindow extends EventEmitter {
  destroyed = false;
  minimized = false;
  visible = true;
  focused = false;
  maximized = false;
  fullscreen = false;
  sent: Array<[string, unknown]> = [];
  reloads = 0;
  openHandler: ((d: { url: string }) => { action: "deny" }) | null = null;
  readonly contents = new EventEmitter();
  readonly webContents = Object.assign(this.contents, {
    send: (channel: string, payload?: unknown) => this.sent.push([channel, payload]),
    reload: () => (this.reloads += 1),
    setWindowOpenHandler: (handler: (d: { url: string }) => { action: "deny" }) => (this.openHandler = handler),
  });
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  isVisible = () => this.visible;
  isFocused = () => this.focused;
  isMaximized = () => this.maximized;
  isFullScreen = () => this.fullscreen;
  restore = () => {
    this.minimized = false;
    this.emit("restore");
  };
  show = () => {
    this.visible = true;
    this.emit("show");
  };
  hide = () => {
    this.visible = false;
    this.emit("hide");
  };
  focus = () => (this.focused = true);
  minimize = () => {
    this.minimized = true;
    this.emit("minimize");
  };
  maximize = () => {
    this.maximized = true;
    this.emit("maximize");
  };
  unmaximize = () => {
    this.maximized = false;
    this.emit("unmaximize");
  };
  setFullScreen = (on: boolean) => {
    this.fullscreen = on;
    this.emit(on ? "enter-full-screen" : "leave-full-screen");
  };
  close = () => {
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    this.emit("close", event);
    if (!event.prevented) this.destroyed = true;
    return event;
  };
  destroy = () => (this.destroyed = true);
}

function controller(options: { quitting?: boolean; closeToTray?: boolean; tray?: boolean; tiling?: boolean } = {}) {
  const windows: FakeWindow[] = [];
  const notes: string[] = [];
  const external: string[] = [];
  let hint = false;
  const quits = { count: 0 };
  const gone = { count: 0 };
  const crash = new CrashPolicy(() => Date.now());
  const c = new MainWindowController({
    create: () => {
      const w = new FakeWindow();
      windows.push(w);
      return w as unknown as WindowLike;
    },
    quitting: () => options.quitting ?? false,
    closeToTray: () => options.closeToTray ?? true,
    trayAvailable: () => options.tray ?? true,
    trayHintShown: () => hint,
    markTrayHintShown: () => (hint = true),
    notify: (t) => notes.push(t),
    startQuit: () => (quits.count += 1),
    tiling: options.tiling ?? false,
    openExternal: (u) => external.push(u),
    devServerUrl: undefined,
    appFileUrl: "file:///opt/Nuvo/resources/app/dist/index.html",
    onRendererGone: () => (gone.count += 1),
    reloadAllowed: () => crash.shouldReload(),
    log: () => undefined,
  });
  return { c, windows, notes, external, quits, gone, hint: () => hint };
}

let dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  dirs = [];
});
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(tmpdir(), "nuvo-life-"));
  dirs.push(d);
  return d;
};

function fakeApp(
  lock = true,
): AppLike & { switches: Array<[string, string?]>; quits: number; relaunched: string[][]; exits: number[]; userData: string; given: Record<string, string> } {
  const app = {
    userData: "/home/u/.config/@nuvo/client",
    given: {} as Record<string, string>,
    switches: [] as Array<[string, string?]>,
    quits: 0,
    relaunched: [] as string[][],
    exits: [] as number[],
    getPath: (name: string) => (name === "appData" ? "/home/u/.config" : app.userData),
    setPath: (_n: string, v: string) => (app.userData = v),
    setName: (name: string) => (app.userData = `/home/u/.config/${name}`),
    requestSingleInstanceLock: () => lock,
    quit: () => (app.quits += 1),
    exit: (code: number) => app.exits.push(code),
    relaunch: (o: { args: string[] }) => app.relaunched.push(o.args),
    commandLine: {
      appendSwitch: (n: string, v?: string) => app.switches.push([n, v]),
      hasSwitch: (n: string) => n in app.given,
      getSwitchValue: (n: string) => app.given[n] ?? "",
    },
  };
  return app;
}

describe("start-up", () => {
  it("the app name changes, the profile does not", () => {
    const app = fakeApp();
    keepUserData(app);
    expect(app.userData).toBe("/home/u/.config/@nuvo/client");
  });

  it("the profile is pinned whatever the package name derived", () => {
    for (const derived of ["/home/u/.config/nuvo", "/home/u/.config/@nuvo/client"]) {
      const app = fakeApp();
      app.userData = derived;
      keepUserData(app);
      expect(app.userData).toBe("/home/u/.config/@nuvo/client");
    }
  });

  it("one app id in the code and the build config", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { desktopName: string; build: { appId: string } };
    expect(pkg.build.appId).toBe(APP_ID);
    expect(pkg.desktopName).toBe(`${APP_ID}.desktop`);
  });

  it("an explicit --user-data-dir wins over the pinned profile", () => {
    const app = fakeApp();
    app.given["user-data-dir"] = "/tmp/nuvo-test-profile";
    keepUserData(app);
    expect(app.userData).toBe("/tmp/nuvo-test-profile");
  });

  it("switches: one feature value, portal only on Wayland", () => {
    const wayland = fakeApp();
    applySwitches(wayland, true);
    expect(wayland.switches.filter(([n]) => n === "enable-features")).toEqual([["enable-features", "NetworkServiceInProcess2,GlobalShortcutsPortal"]]);
    expect(wayland.switches).toContainEqual(["disable-http2", undefined]);
    expect(wayland.switches).toContainEqual(["disable-features", "AudioServiceOutOfProcess"]);
    const x11 = fakeApp();
    applySwitches(x11, false);
    expect(x11.switches.find(([n]) => n === "enable-features")).toEqual(["enable-features", "NetworkServiceInProcess2"]);
  });

  it("a second instance quits without a window", () => {
    const app = fakeApp(false);
    const lines: string[] = [];
    expect(takeInstanceLock(app, (l) => lines.push(l))).toBe(false);
    expect(app.quits).toBe(1);
    expect(lines).toEqual(["Nuvo is already running"]);
  });

  it("show restores, shows or recreates the window", () => {
    const t = controller();
    t.c.show();
    const w = t.windows[0];
    w.minimized = true;
    t.c.show();
    expect(w.minimized).toBe(false);
    w.hide();
    t.c.show();
    expect(w.visible && w.focused).toBe(true);
    w.destroyed = true;
    t.c.show();
    expect(t.windows).toHaveLength(2);
  });

  it("a launch during quitting relaunches without inspector flags", () => {
    const app = fakeApp();
    onSecondInstance(["/opt/nuvo", "--inspect=9229", "--flag"], { quitting: true, app, show: vi.fn(), receiveLink: vi.fn(), findLink: findLinkArg });
    expect(app.relaunched).toEqual([["--flag"]]);
    expect(app.exits).toEqual([0]);
  });

  it("a second launch with a link shows the window and delivers it", () => {
    const show = vi.fn();
    const receive = vi.fn();
    onSecondInstance(["/opt/nuvo", "nuvo://track?id=Nuvo0Track1"], { quitting: false, app: fakeApp(), show, receiveLink: receive, findLink: findLinkArg });
    expect(show).toHaveBeenCalled();
    expect(receive).toHaveBeenCalledWith("nuvo://track?id=Nuvo0Track1");
  });
});

describe("close rules", () => {
  it("close-to-tray hides, notifies once and remembers the hint", () => {
    const t = controller();
    t.c.show();
    expect(t.windows[0].close().prevented).toBe(true);
    expect(t.windows[0].visible).toBe(false);
    t.windows[0].close();
    expect(t.notes).toEqual(["Nuvo keeps playing in the tray."]);
    expect(t.hint()).toBe(true);
  });

  it("without a tray the app quits", () => {
    const t = controller({ tray: false });
    t.c.show();
    t.windows[0].close();
    expect(t.quits.count).toBe(1);
  });

  it("close-to-tray off quits", () => {
    const t = controller({ closeToTray: false });
    t.c.show();
    t.windows[0].close();
    expect(t.quits.count).toBe(1);
  });

  it("while quitting the close goes through", () => {
    const t = controller({ quitting: true });
    t.c.show();
    expect(t.windows[0].close().prevented).toBe(false);
  });

  it("a window hidden in the tray keeps the app running", () => {
    const t = controller();
    t.c.show();
    t.windows[0].close();
    expect(t.windows[0].destroyed).toBe(false);
    expect(t.quits.count).toBe(0);
  });
});

describe("onScreenBounds", () => {
  const laptop = { x: 0, y: 0, width: 1920, height: 1080 };
  const monitor = { x: 1920, y: 0, width: 2560, height: 1440 };

  it("leaves a visible window exactly where it is", () => {
    const bounds = { x: 2000, y: 100, width: 1200, height: 780 };
    expect(onScreenBounds(bounds, [laptop, monitor])).toBe(bounds);
    const hanging = { x: 1700, y: 50, width: 1200, height: 780 };
    expect(onScreenBounds(hanging, [laptop])).toBe(hanging);
  });

  it("brings back a window from a monitor that is gone", () => {
    expect(onScreenBounds({ x: 2600, y: 300, width: 1200, height: 780 }, [laptop])).toEqual({ x: 360, y: 150, width: 1200, height: 780 });
  });

  it("a window with only its corner in view or its title bar above the screen is brought back", () => {
    expect(onScreenBounds({ x: 1915, y: 1075, width: 1200, height: 780 }, [laptop]).x).toBe(360);
    expect(onScreenBounds({ x: 100, y: -500, width: 1200, height: 780 }, [laptop]).y).toBe(150);
  });

  it("fits a window bigger than what is left, and does nothing with no display info", () => {
    expect(onScreenBounds({ x: 3000, y: 0, width: 2400, height: 1400 }, [laptop])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    const bounds = { x: 9000, y: 0, width: 800, height: 600 };
    expect(onScreenBounds(bounds, [])).toBe(bounds);
  });
});

describe("window controls", () => {
  it("minimise is ignored in fullscreen and on tiling compositors", () => {
    const t = controller();
    t.c.show();
    t.windows[0].fullscreen = true;
    t.c.minimize();
    expect(t.windows[0].minimized).toBe(false);
    const h = controller({ tiling: true });
    h.c.show();
    h.c.minimize();
    expect(h.windows[0].minimized).toBe(false);
    t.windows[0].fullscreen = false;
    t.c.minimize();
    expect(t.windows[0].minimized).toBe(true);
  });

  it("toggle maximise leaves fullscreen, restores or maximises", () => {
    const t = controller();
    t.c.show();
    const w = t.windows[0];
    w.fullscreen = true;
    t.c.toggleMaximize();
    expect(w.fullscreen).toBe(false);
    w.maximized = true;
    t.c.toggleMaximize();
    expect(w.maximized).toBe(false);
    t.c.toggleMaximize();
    expect(w.maximized).toBe(true);
  });

  it("every window change sends win:state", () => {
    const t = controller();
    t.c.show();
    const w = t.windows[0];
    w.sent = [];
    w.maximize();
    w.unmaximize();
    w.setFullScreen(true);
    w.setFullScreen(false);
    w.minimize();
    w.restore();
    w.hide();
    w.show();
    const states = w.sent.filter(([c]) => c === "win:state").map(([, s]) => s);
    expect(states).toHaveLength(8);
    expect(states[0]).toEqual({ maximized: true, fullscreen: false, visible: true });
    expect(states[4]).toEqual({ maximized: false, fullscreen: false, visible: false });
  });

  it("window.open: web to the browser, never a window", () => {
    const t = controller();
    t.c.show();
    expect(t.windows[0].openHandler!({ url: "https://example.org" })).toEqual({ action: "deny" });
    expect(t.windows[0].openHandler!({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(t.external).toEqual(["https://example.org"]);
  });

  it("navigation away is prevented; the app's own page proceeds", () => {
    const t = controller();
    t.c.show();
    const nav = (url: string) => {
      // Electron 44 reports a main-frame navigation as will-frame-navigate only, with the url on the event
      const event = { url, isMainFrame: true, prevented: false, preventDefault: () => (event.prevented = true) };
      t.windows[0].contents.emit("will-frame-navigate", event);
      return event.prevented;
    };
    expect(nav("https://example.org")).toBe(true);
    expect(t.external).toEqual(["https://example.org"]);
    expect(nav("file:///opt/Nuvo/resources/app/dist/index.html#/library")).toBe(false);
  });

  it("subframe navigation and redirects away are prevented and never open the browser", () => {
    const t = controller();
    t.c.show();
    const emit = (name: string, url: string, isMainFrame: boolean) => {
      const event = { url, isMainFrame, prevented: false, preventDefault: () => (event.prevented = true) };
      t.windows[0].contents.emit(name, event, url);
      return event.prevented;
    };
    expect(emit("will-frame-navigate", "https://example.org", false)).toBe(true);
    expect(emit("will-frame-navigate", "javascript:alert(1)", false)).toBe(true);
    expect(emit("will-redirect", "https://example.org", true)).toBe(true);
    expect(emit("will-redirect", "file:///opt/Nuvo/resources/app/dist/index.html", true)).toBe(false);
    expect(t.external).toEqual([]);
  });
});

describe("shutdown", () => {
  const shutdown = (options: { renderer?: (deadlineMs: number) => Promise<void> | null; steps?: Array<[string, () => void]>; quit?: () => void } = {}) => {
    const log = vi.fn();
    const exit = vi.fn();
    const ran: string[] = [];
    const steps = options.steps ?? [
      ["daemon", () => ran.push("daemon")],
      ["notch", () => ran.push("notch")],
      ["windows", () => ran.push("windows")],
    ];
    const s = new Shutdown({ askRenderer: options.renderer ?? (() => null), steps, quit: options.quit ?? vi.fn(), exit, log });
    return { s, log, exit, ran };
  };

  it("the renderer is asked first and cleanup follows its answer", async () => {
    let answer!: () => void;
    const asked: number[] = [];
    const t = shutdown({ renderer: (deadline) => (asked.push(deadline), new Promise<void>((r) => (answer = r))) });
    const run = t.s.run();
    await Promise.resolve();
    expect(asked).toEqual([800]);
    expect(t.ran).toEqual([]);
    answer();
    await run;
    expect(t.ran).toEqual(["notch", "windows", "daemon"]);
  });

  it("a silent renderer delays cleanup by 800 ms only", async () => {
    vi.useFakeTimers();
    const t = shutdown({ renderer: () => new Promise(() => undefined) });
    const run = t.s.run();
    await vi.advanceTimersByTimeAsync(799);
    expect(t.ran).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(t.ran).toHaveLength(3);
  });

  it("a throwing step does not stop the others", async () => {
    const ran: string[] = [];
    const t = shutdown({
      steps: [
        ["a", () => ran.push("a")],
        [
          "b",
          () => {
            throw new Error("boom");
          },
        ],
        ["c", () => ran.push("c")],
      ],
    });
    await t.s.run();
    expect(ran).toEqual(["a", "c"]);
    expect(t.log).toHaveBeenCalledTimes(1);
  });

  it("every trigger after the first does nothing", async () => {
    const t = shutdown();
    await Promise.all([t.s.run(), t.s.run(), t.s.run()]);
    expect(t.ran).toEqual(["notch", "windows", "daemon"]);
  });

  it("the watchdog exits after 4 s; a throwing quit exits at once", async () => {
    vi.useFakeTimers();
    const t = shutdown();
    await t.s.run();
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.exit).toHaveBeenCalledWith(0);
    const q = shutdown({
      quit: () => {
        throw new Error("stuck");
      },
    });
    await q.s.run();
    expect(q.exit).toHaveBeenCalledWith(0);
  });

  it("leftover children are killed", async () => {
    const children = [
      {
        killed: false,
        kill() {
          this.killed = true;
        },
      },
      {
        killed: false,
        kill() {
          this.killed = true;
        },
      },
    ];
    const t = shutdown({ steps: [["children", () => children.forEach((c) => c.kill())]] });
    await t.s.run();
    expect(children.every((c) => c.killed)).toBe(true);
  });

  it("windows are destroyed, bypassing close handlers", async () => {
    const w = new FakeWindow();
    w.on("close", (e: { preventDefault(): void }) => e.preventDefault());
    w.visible = false;
    const t = shutdown({ steps: [["windows", () => w.destroy()]] });
    await t.s.run();
    expect(w.destroyed).toBe(true);
  });
});

describe("sleep blocker and crashes", () => {
  it("one blocker while playing or loading", () => {
    const calls: string[] = [];
    let n = 0;
    const blocker = new SleepBlocker({ start: () => (calls.push("start"), ++n), stop: () => calls.push("stop") });
    for (const s of ["playing", "playing", "loading", "paused", "playing", "idle"] as const) blocker.update(s);
    expect(calls).toEqual(["start", "stop", "start", "stop"]);
  });

  it("a crash idles every surface and reloads once per minute", () => {
    vi.useFakeTimers();
    const relay = new PlayerRelay();
    const blocker = new SleepBlocker({ start: () => 1, stop: vi.fn() });
    relay.read((s) => blocker.update(s.status));
    relay.accept({
      trackId: "t",
      title: "",
      artists: "",
      durationMs: 1,
      positionMs: 0,
      sampledAt: 0,
      status: "playing",
      liked: false,
      source: "youtube",
      upNext: [],
    });
    const t = controller();
    t.c.show();
    const w = t.windows[0];
    const crash = () => {
      relay.rendererGone(Date.now());
      w.contents.emit("render-process-gone", {}, { reason: "crashed" });
    };
    crash();
    expect(relay.latest.status).toBe("idle");
    expect(w.reloads).toBe(1);
    vi.advanceTimersByTime(30_000);
    crash();
    expect(w.reloads).toBe(1);
  });
});

describe("app icon", () => {
  const png = (byte: number) => `data:image/png;base64,${Buffer.from([0x89, 0x50, byte]).toString("base64")}`;
  const installer = (dataHome: string, packaged = true) => {
    const refreshes: string[] = [];
    const icons: Buffer[] = [];
    const i = new IconInstaller({
      packaged,
      platform: "linux",
      dataHome,
      iconName: "nuvo",
      scale: (bytes, size) => Buffer.concat([bytes, Buffer.from([size])]),
      refreshCache: async (dir) => void refreshes.push(dir),
      setWindowIcon: (b) => icons.push(b),
    });
    return { i, refreshes, icons };
  };
  const file = (home: string, size: number) => path.join(home, "icons", "hicolor", `${size}x${size}`, "apps", "nuvo.png");

  it("seven theme files, the 512 one byte for byte, one cache refresh", async () => {
    const home = tempDir();
    const t = installer(home);
    await t.i.apply(png(1), false);
    for (const size of [16, 32, 48, 64, 128, 256, 512]) expect(fs.existsSync(file(home, size))).toBe(true);
    expect(fs.readFileSync(file(home, 512))).toEqual(Buffer.from([0x89, 0x50, 1]));
    expect(t.refreshes).toHaveLength(1);
  });

  it("the same bytes twice write nothing", async () => {
    const home = tempDir();
    const t = installer(home);
    await t.i.apply(png(1), false);
    await t.i.apply(png(1), false);
    expect(t.refreshes).toHaveLength(1);
  });

  it("the stock icon removes the files; nothing installed means no refresh", async () => {
    const home = tempDir();
    const t = installer(home);
    await t.i.apply(png(1), false);
    await t.i.apply(png(1), true);
    expect(fs.existsSync(file(home, 512))).toBe(false);
    expect(t.refreshes).toHaveLength(2);
    const empty = installer(tempDir());
    await empty.i.apply(png(1), true);
    expect(empty.refreshes).toHaveLength(0);
  });

  it("a custom icon then the default in one tick ends with no files", async () => {
    const home = tempDir();
    const t = installer(home);
    await Promise.all([t.i.apply(png(2), false), t.i.apply(png(2), true)]);
    expect(fs.existsSync(file(home, 512))).toBe(false);
  });

  it("development builds change only the window icon", async () => {
    const home = tempDir();
    const t = installer(home, false);
    await t.i.apply(png(3), false);
    expect(t.icons).toHaveLength(1);
    expect(fs.existsSync(path.join(home, "icons"))).toBe(false);
  });
});

describe("storage and drag", () => {
  it("the larger cache figure wins; a failure gives zeros with the path", async () => {
    const userData = tempDir();
    fs.mkdirSync(path.join(userData, "Cache"));
    fs.writeFileSync(path.join(userData, "Cache", "f"), Buffer.alloc(100));
    expect((await chromiumUsage(userData, async () => 5000)).httpCacheBytes).toBe(5000);
    const failed = await chromiumUsage(userData, async () => Promise.reject(new Error("x")));
    expect(failed).toEqual({
      httpCacheBytes: 0,
      codeCacheBytes: 0,
      localStorageBytes: 0,
      indexedDbBytes: 0,
      serviceWorkerBytes: 0,
      blobBytes: 0,
      path: path.join(userData, "Cache"),
    });
  });

  it("reveal only inside downloads, home or the last save", () => {
    const home = tempDir();
    const downloads = path.join(home, "Downloads");
    fs.mkdirSync(downloads);
    fs.writeFileSync(path.join(downloads, "a.json"), "{}");
    const roots = { home, downloads, lastSave: null };
    expect(revealTarget(path.join(downloads, "a.json"), roots)).toEqual({ path: path.join(downloads, "a.json"), folder: false });
    expect(revealTarget("/etc/passwd", roots)).toBeNull();
    expect(revealTarget(path.join(downloads, "missing.json"), roots)).toEqual({ path: downloads, folder: true });
  });

  it("drag moves by the cursor travel with the start size", () => {
    expect(dragBounds({ x: 100, y: 100, width: 800, height: 600 }, { x: 150, y: 120 }, { x: 400, y: 300 })).toEqual({
      x: 350,
      y: 280,
      width: 800,
      height: 600,
    });
  });

  it("dragging a maximised window restores it under the cursor", () => {
    expect(restoreUnderCursor({ x: 0, y: 0, width: 1920, height: 1080 }, { width: 800, height: 600 }, { x: 960, y: 10 })).toEqual({
      x: 560,
      y: 0,
      width: 800,
      height: 600,
    });
  });
});

describe("every web contents", () => {
  const fake = () => {
    const contents = Object.assign(new EventEmitter(), {
      openHandler: null as ((d: { url: string }) => { action: "deny" }) | null,
      setWindowOpenHandler: (h: (d: { url: string }) => { action: "deny" }) => (contents.openHandler = h),
    });
    return contents;
  };
  const navigate = (contents: EventEmitter, name: string, url: string) => {
    const event = { url, isMainFrame: true, prevented: false, preventDefault: () => (event.prevented = true) };
    contents.emit(name, event, url);
    return event.prevented;
  };

  it("never opens a window and keeps every navigation event to the allowed pages", () => {
    const contents = fake();
    guardContents(contents, (url) => url.startsWith("file:///app/"));
    expect(contents.openHandler!({ url: "https://example.org" })).toEqual({ action: "deny" });
    for (const name of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
      expect(navigate(contents, name, "https://example.org")).toBe(true);
      expect(navigate(contents, name, "javascript:alert(1)")).toBe(true);
      expect(navigate(contents, name, "file:///app/index.html#/notch")).toBe(false);
    }
  });

  it("the main window keeps its browser rule and opens the browser once", () => {
    const t = controller();
    t.c.show();
    guardContents(t.windows[0].contents as never, () => false);
    expect(navigate(t.windows[0].contents, "will-frame-navigate", "https://example.org")).toBe(true);
    expect(t.external).toEqual(["https://example.org"]);
  });
});

describe("shutdown budget", () => {
  it("the daemon step starts early enough to finish its stop before the watchdog", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const quit = vi.fn();
    let daemonStartedAt = -1;
    let daemonDone = false;
    const start = Date.now();
    const s = new Shutdown({
      askRenderer: () => new Promise<void>(() => undefined),
      steps: [
        [
          "daemon",
          () =>
            new Promise<void>((resolve) => {
              daemonStartedAt = Date.now() - start;
              setTimeout(() => {
                daemonDone = true;
                resolve();
              }, DAEMON_BUDGET_MS - 300);
            }),
        ],
        ["hung1", () => new Promise<void>(() => undefined)],
        ["hung2", () => new Promise<void>(() => undefined)],
        ["hung3", () => new Promise<void>(() => undefined)],
      ],
      quit,
      exit,
      log: vi.fn(),
    });
    const run = s.run();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1);
    await run;
    expect(daemonStartedAt).toBeLessThanOrEqual(WATCHDOG_MS - DAEMON_BUDGET_MS);
    expect(daemonDone).toBe(true);
    expect(quit).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("every other step still starts, the daemon last", async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const s = new Shutdown({
      askRenderer: () => null,
      steps: [
        ["daemon", () => void ran.push("daemon")],
        ["hung", () => (ran.push("hung"), new Promise<void>(() => undefined))],
        ["tray", () => void ran.push("tray")],
        ["late", () => (ran.push("late"), new Promise<void>(() => undefined))],
      ],
      quit: vi.fn(),
      exit: vi.fn(),
      log: vi.fn(),
    });
    const run = s.run();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    await run;
    expect(ran).toEqual(["hung", "tray", "late", "daemon"]);
  });
});

describe("shutdown hardening and window restore", () => {
  it("a throwing askRenderer still runs every step, the daemon last, and quits", async () => {
    const ran: string[] = [];
    const quit = vi.fn();
    const s = new Shutdown({
      askRenderer: () => {
        throw new Error("destroyed");
      },
      steps: [
        ["daemon", () => void ran.push("daemon")],
        ["notch", () => void ran.push("notch")],
      ],
      quit,
      exit: vi.fn(),
      log: vi.fn(),
    });
    await s.run();
    expect(ran).toEqual(["notch", "daemon"]);
    expect(quit).toHaveBeenCalled();
  });

  it("a hung step times out and later steps still run", async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const s = new Shutdown({
      askRenderer: () => null,
      steps: [
        ["hung", () => new Promise<void>(() => undefined)],
        ["daemon", () => void ran.push("daemon")],
      ],
      quit: vi.fn(),
      exit: vi.fn(),
      log: vi.fn(),
    });
    const run = s.run();
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(ran).toEqual(["daemon"]);
  });

  it("an answered handshake leaves no pending timer", async () => {
    vi.useFakeTimers();
    const s = new Shutdown({ askRenderer: () => Promise.resolve(), steps: [], quit: vi.fn(), exit: vi.fn(), log: vi.fn() });
    await s.run();
    expect(vi.getTimerCount()).toBe(1); // only the watchdog
  });

  const left = { x: 0, y: 0, width: 1920, height: 1080 };
  const right = { x: 1920, y: 0, width: 1920, height: 1080 };
  const size = { width: 1200, height: 780 };
  it("restore keeps bounds on the second monitor", () => {
    const saved = { x: 2000, y: 100, width: 1000, height: 700 };
    expect(restoreBounds(saved, [left, right], left, size)).toEqual(saved);
  });
  it("an unplugged monitor centres on the primary with the default size", () => {
    expect(restoreBounds({ x: 2000, y: 100, width: 1000, height: 700 }, [left], left, size)).toEqual({ x: 360, y: 150, width: 1200, height: 780 });
  });
  it("negative coordinates on a left monitor work; off-screen ones do not", () => {
    const west = { x: -1920, y: 0, width: 1920, height: 1080 };
    const saved = { x: -1500, y: 50, width: 800, height: 600 };
    expect(restoreBounds(saved, [west, left], left, size)).toEqual(saved);
    expect(restoreBounds({ x: -5000, y: -5000, width: 800, height: 600 }, [west, left], left, size)).toEqual({ x: 360, y: 150, width: 1200, height: 780 });
  });
  it("huge sizes are clamped to the work area, a missing or broken save uses defaults", () => {
    expect(restoreBounds({ x: 0, y: 0, width: 9000, height: 9000 }, [left], left, size)).toEqual(left);
    expect(restoreBounds(null, [left], left, size)).toEqual({ x: 360, y: 150, width: 1200, height: 780 });
    expect(restoreBounds({ x: 10, y: 10, width: 0, height: 0 }, [left], left, size).width).toBe(1200);
    expect(restoreBounds({ x: NaN, y: 0, width: 500, height: 500 }, [left], left, size).width).toBe(1200);
  });
  it("a repeat crash shows a notice instead of reloading", () => {
    expect(crashRecovery(true)).toBe("reload");
    expect(crashRecovery(false)).toBe("notice");
    const t = controller();
    t.c.show();
    const w = t.windows[0];
    vi.useFakeTimers();
    w.contents.emit("render-process-gone", {}, { reason: "crashed" });
    w.contents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(w.reloads).toBe(1);
    expect(t.notes.some((n) => n.includes("stopped reloading"))).toBe(true);
  });
});
