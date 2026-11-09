import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;

interface TestTrack {
  id: string;
  title: string;
  artists: string;
  coverUrl: string;
  durationMs: number;
}
interface Handle {
  engine: {
    playList(tracks: TestTrack[]): void;
    playEntry(entryId: string): void;
    getView(): {
      status: string;
      pauseReason: string | null;
      index: number;
      positionMs: number;
      entries: Array<{ entryId: string; track: TestTrack }>;
      tempo: { rate: number; semitones: number };
    };
    next(): void;
    previous(): void;
    seekTo(positionMs: number, options?: { andPlay?: boolean }): void;
    append(track: TestTrack): void;
    insertNext(track: TestTrack): void;
    remove(entryId: string): unknown;
    move(entryId: string, targetIndex: number): void;
    setTempo(change: { rate?: number; semitones?: number; linked?: boolean }): void;
    pauseFor(reason: "sleep" | "device_lost"): void;
    play(): void;
  };
  output: { list(): Promise<Array<{ id: string; label: string }>>; choose(id: string): Promise<void> };
  decks: {
    soundBus: {
      shapeEq(state: { enabled: boolean; gains: number[]; preampDb: number; bypass: boolean }): void;
      analyser(): AnalyserNode | null;
      pitchAvailable(): boolean;
      setSleepLevel(multiplier: number): void;
    };
  };
  dispose(): void;
}
const handle = () => (window as unknown as { __nuvoPlayer: Handle }).__nuvoPlayer;

function has(command: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function watcherPresent(): boolean {
  try {
    const out = execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        "org.freedesktop.DBus.NameHasOwner",
        "org.kde.StatusNotifierWatcher",
      ],
      { timeout: 2000 },
    ).toString();
    return out.trim() === "(true,)";
  } catch {
    return false;
  }
}

function toneWav(seconds: number): Buffer {
  const rate = 48_000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const track = (id: string, seconds: number): TestTrack => ({ id, title: `Tone ${id}`, artists: "Nuvo", coverUrl: "", durationMs: seconds * 1000 });

async function putTone(page: Page, id: string, seconds: number): Promise<void> {
  const wav = toneWav(seconds).toString("base64");
  const status = await page.evaluate(
    async ({ id, wav }) => {
      const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
      const response = await fetch(`nuvo-core://local/v1/cache/audio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "audio/wav", "X-Nuvo-Codec": "pcm" },
        body: bytes,
      });
      return response.status;
    },
    { id, wav },
  );
  expect(status).toBeLessThan(300);
}

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;
const problems: string[] = [];

beforeAll(async () => {
  isolation = isolate("nuvo-shell-e2e");
  app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--ozone-platform=x11", `--user-data-dir=${isolation.userData}`],
    cwd: ROOT,
    env: isolation.env,
  });
  main = await app.firstWindow();
  main.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
  });
  main.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await main.waitForFunction(() => Boolean(window.nuvoShell));
  await main.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer));
  // page callbacks are serialized, so the page needs its own `handle`
  await main.evaluate(() => {
    (window as unknown as { handle: () => unknown }).handle = () => (window as unknown as { __nuvoPlayer: unknown }).__nuvoPlayer;
  });
  await main.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
}, 120_000);

afterAll(async () => {
  const pid = app?.process().pid;
  await app?.close().catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  isolation?.dispose();
});

describe("shell e2e", () => {
  it("the packaged page denies by default and still reaches the daemon", async () => {
    const meta = await main.$eval('meta[http-equiv="Content-Security-Policy"]', (el) => el.getAttribute("content"));
    expect(meta).toContain("default-src 'self'");
    const result = await main.evaluate(async () => {
      const blocked = await fetch("https://example.org").then(
        () => "allowed",
        () => "blocked",
      );
      const health = await fetch("nuvo-core://local/health").then(
        (r) => r.status,
        () => 0,
      );
      return { blocked, health };
    });
    expect(result).toEqual({ blocked: "blocked", health: 200 });
  });

  it("covers and avatars load under the policy, the worker and worklet urls pass it", async () => {
    const hosts = [
      "https://i.ytimg.com/vi/aqz-KE-bpKQ/default.jpg",
      "https://yt3.googleusercontent.com/x",
      "https://lh3.googleusercontent.com/x",
      "https://i1.sndcdn.com/x.jpg",
    ];
    // a CSP block fires securitypolicyviolation; a network error does not
    const blocked = await main.evaluate(async (urls) => {
      const violations: string[] = [];
      const listener = (event: SecurityPolicyViolationEvent) => violations.push(event.blockedURI);
      document.addEventListener("securitypolicyviolation", listener);
      await Promise.all(
        urls.map(
          (url) =>
            new Promise<void>((resolve) => {
              const image = new Image();
              image.onload = image.onerror = () => resolve();
              image.src = url;
            }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      document.removeEventListener("securitypolicyviolation", listener);
      return violations;
    }, hosts);
    expect(blocked).toEqual([]);
    expect(problems.filter((text) => /Content Security Policy/.test(text) && /worker|worklet|script|\.js/.test(text))).toEqual([]);
  });

  it("nuvoShell exposes the documented members as functions", async () => {
    const names = [
      "minimize",
      "toggleMaximize",
      "toggleFullscreen",
      "close",
      "getWinState",
      "onWinState",
      "drag",
      "getAppInfo",
      "quit",
      "onBeforeQuit",
      "quitReady",
      "applyIcon",
      "reveal",
      "chromiumUsage",
      "clearChromiumCache",
      "systemMuted",
      "unmuteSystem",
      "takePendingLink",
      "onLink",
      "getCoreStatus",
      "onCoreStatus",
      "sendPlayerState",
      "onRemoteCommand",
      "onNetworkChanged",
      "getUpdateState",
      "onUpdateState",
      "installUpdate",
      "openReleasePage",
      "onAppCommand",
      "getTrayStatus",
      "getMainSettings",
      "setMainSetting",
      "getDiscordStatus",
      "setGlobalShortcuts",
      "notchUpdateLyrics",
      "notchUpdateSettings",
      "getPanelStatus",
      "installPanelWidget",
      "enablePanelWidget",
      "openExtensionsApp",
      "youtubeCall",
      "saveTextFile",
      "listSystemFonts",
      "importFontFile",
      "deleteFontFile",
      "exportTheme",
      "importThemeFile",
      "appearanceReady",
      "appearanceApplying",
      "addMusicFolder",
      "revealLocalTrack",
      "saveAsFiles",
      "saveDocument",
      "pickCoverImage",
      "recognizeFile",
      "notify",
    ];
    const shape = await main.evaluate((names) => {
      const shell = window.nuvoShell as unknown as Record<string, unknown>;
      return { missing: names.filter((name) => typeof shell[name] !== "function"), extra: Object.keys(shell).filter((key) => !names.includes(key)) };
    }, names);
    expect(shape).toEqual({ missing: [], extra: [] });
    const results = await main.evaluate(async () => {
      const shell = window.nuvoShell!;
      const unsubscribers = [
        shell.onWinState(() => undefined),
        shell.onLink(() => undefined),
        shell.onCoreStatus(() => undefined),
        shell.onRemoteCommand(() => undefined),
        shell.onAppCommand(() => undefined),
        shell.onBeforeQuit(() => undefined),
      ];
      unsubscribers.forEach((off) => off());
      return {
        unsubscribe: unsubscribers.map((off) => typeof off),
        info: await shell.getAppInfo(),
        win: await shell.getWinState(),
        tray: await shell.getTrayStatus(),
        usage: Object.keys(await shell.chromiumUsage()).sort(),
        youtubeBad: await shell.youtubeCall("content-token", "not an object").then(
          () => "resolved",
          (error: Error) => String(error.message),
        ),
      };
    });
    expect(results.unsubscribe).toEqual(Array(6).fill("function"));
    expect(results.info.packaged).toBe(false);
    expect(typeof results.info.version).toBe("string");
    expect(Object.keys(results.win).sort()).toEqual(["fullscreen", "maximized", "visible"]);
    expect(typeof results.tray.available).toBe("boolean");
    expect(results.usage).toContain("httpCacheBytes");
    expect(results.youtubeBad).not.toBe("resolved");
  });

  it("an external link in the main window opens the browser and creates no window", async () => {
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { __opened: string[] }).__opened = opened;
      (shell as unknown as { openExternal: (url: string) => Promise<void> }).openExternal = async (url) => {
        opened.push(url);
      };
    });
    const windowsBefore = app.windows().length;
    await main.evaluate(() => {
      window.open("https://example.org/from-open", "_blank");
      const link = document.createElement("a");
      link.href = "https://example.org/from-link";
      link.target = "_blank";
      document.body.append(link);
      link.click();
      link.remove();
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened))
      .toEqual(["https://example.org/from-open", "https://example.org/from-link"]);
    expect(app.windows().length).toBe(windowsBefore);
    expect(main.url()).toContain("index.html");
    const attempt = await main.evaluate(() => {
      window.location.href = "https://example.org/navigate";
      return location.href;
    });
    expect(attempt).toContain("index.html");
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.length), { timeout: 5000 }).toBe(3);
  });

  it("plays the first track after a real gesture: context running, pitch worklet loaded", async () => {
    await putTone(main, "e2etoneA", 20);
    await main.mouse.click(300, 300);
    await main.evaluate((t) => handle().engine.playList([t]), track("e2etoneA", 20));
    await expect.poll(() => main.evaluate(() => handle().engine.getView().status), { timeout: 15_000 }).toBe("playing");
    const graph = await main.evaluate(() => {
      const analyser = handle().decks.soundBus.analyser();
      return { state: analyser?.context.state ?? null, pitch: handle().decks.soundBus.pitchAvailable() };
    });
    expect(graph).toEqual({ state: "running", pitch: true });
  });

  it("skip, seek, queue edits", async () => {
    for (const id of ["q1", "q2", "q3"]) await putTone(main, id, 20);
    await main.evaluate(([a, b, c]) => handle().engine.playList([a, b, c]), [track("q1", 20), track("q2", 20), track("q3", 20)]);
    await expect.poll(() => main.evaluate(() => handle().engine.getView().status)).toBe("playing");
    const index = () => main.evaluate(() => handle().engine.getView().index);
    expect(await index()).toBe(0);
    await main.evaluate(() => handle().engine.next());
    await expect.poll(index).toBe(1);
    await main.evaluate(() => handle().engine.seekTo(8000));
    await expect.poll(() => main.evaluate(() => handle().engine.getView().positionMs), { timeout: 5000 }).toBeGreaterThan(7500);
    expect(await main.evaluate(() => handle().engine.getView().positionMs)).toBeLessThan(11_000);
    await main.evaluate(() => handle().engine.previous());
    await expect.poll(async () => (await index()) === 0 || (await main.evaluate(() => handle().engine.getView().positionMs)) < 1500).toBe(true);
    await main.evaluate((t) => handle().engine.append(t), track("q4", 20));
    await main.evaluate((t) => handle().engine.insertNext(t), track("q5", 20));
    const ids = () =>
      main.evaluate(() =>
        handle()
          .engine.getView()
          .entries.map((entry) => entry.track.id),
      );
    const before = await ids();
    expect(before).toContain("q4");
    expect(before[before.indexOf("q5") - 1]).toBe(await main.evaluate(() => handle().engine.getView().entries[handle().engine.getView().index].track.id));
    const entryId = await main.evaluate(
      () =>
        handle()
          .engine.getView()
          .entries.find((entry) => entry.track.id === "q4")!.entryId,
    );
    await main.evaluate((id) => handle().engine.move(id, 0), entryId);
    expect((await ids())[0]).toBe("q4");
    await main.evaluate((id) => handle().engine.remove(id), entryId);
    expect(await ids()).not.toContain("q4");
  });

  it("EQ preamp changes the signal, speed changes the clock rate, sleep pauses with its reason", async () => {
    await putTone(main, "fx1", 30);
    await main.evaluate((t) => handle().engine.playList([t]), track("fx1", 30));
    await expect.poll(() => main.evaluate(() => handle().engine.getView().status)).toBe("playing");
    const level = () =>
      main.evaluate(async () => {
        const analyser = handle().decks.soundBus.analyser()!;
        const data = new Float32Array(analyser.fftSize);
        await new Promise((resolve) => setTimeout(resolve, 300));
        analyser.getFloatTimeDomainData(data);
        return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
      });
    const gains = Array(10).fill(0);
    await main.evaluate((gains) => handle().decks.soundBus.shapeEq({ enabled: true, gains, preampDb: 0, bypass: false }), gains);
    const flat = await level();
    await main.evaluate((gains) => handle().decks.soundBus.shapeEq({ enabled: true, gains, preampDb: -12, bypass: false }), gains);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const quiet = await level();
    console.log(`[e2e] RMS flat ${flat.toFixed(4)}, preamp -12 dB ${quiet.toFixed(4)}`);
    expect(flat).toBeGreaterThan(0.01);
    expect(quiet).toBeLessThan(flat * 0.5);
    await main.evaluate((gains) => handle().decks.soundBus.shapeEq({ enabled: false, gains, preampDb: 0, bypass: true }), gains);

    await main.evaluate(() => handle().engine.seekTo(2000, { andPlay: true }));
    await main.evaluate(() => handle().engine.setTempo({ rate: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const slow = await main.evaluate(async () => {
      const start = handle().engine.getView().positionMs;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return handle().engine.getView().positionMs - start;
    });
    await main.evaluate(() => handle().engine.setTempo({ rate: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const fast = await main.evaluate(async () => {
      const start = handle().engine.getView().positionMs;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return handle().engine.getView().positionMs - start;
    });
    console.log(`[e2e] position advance in 2 s: x1 ${slow} ms, x2 ${fast} ms`);
    expect(fast / slow).toBeGreaterThan(1.6);
    expect(fast / slow).toBeLessThan(2.4);
    await main.evaluate(() => handle().engine.setTempo({ rate: 1, semitones: 3, linked: false }));
    expect(await main.evaluate(() => handle().engine.getView().tempo)).toMatchObject({ rate: 1, semitones: 3 });
    await main.evaluate(() => handle().engine.setTempo({ rate: 1, semitones: 0 }));

    await main.evaluate(() => {
      handle().decks.soundBus.setSleepLevel(0.3);
      handle().engine.pauseFor("sleep");
    });
    await expect
      .poll(() => main.evaluate(() => ({ status: handle().engine.getView().status, reason: handle().engine.getView().pauseReason })))
      .toEqual({ status: "paused", reason: "sleep" });
    await main.evaluate(() => {
      handle().decks.soundBus.setSleepLevel(1);
      handle().engine.play();
    });
    await expect.poll(() => main.evaluate(() => handle().engine.getView().status)).toBe("playing");
  });

  it.runIf(has("pactl"))("the output picker sees a PipeWire sink and moves the stream there", async () => {
    const module = execFileSync("pactl", ["load-module", "module-null-sink", "sink_name=nuvo_test_a", "sink_properties=device.description=nuvo_test_a"])
      .toString()
      .trim();
    try {
      const id = "e2etone001";
      await putTone(main, id, 20);
      const label = await main.evaluate(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.find((d) => d.kind === "audiooutput" && d.label.includes("nuvo_test_a"))?.label ?? null;
      });
      expect(label).not.toBeNull();
      await main.evaluate(
        async ({ t }) => {
          const booted = handle();
          booted.engine.playList([t]);
          const outputs = await booted.output.list();
          await booted.output.choose(outputs.find((o) => o.label.includes("nuvo_test_a"))!.id);
        },
        { t: track(id, 20) },
      );
      await expect.poll(() => execFileSync("pactl", ["list", "sink-inputs"]).toString(), { timeout: 5000 }).toContain("nuvo_test_a");
    } finally {
      await main.evaluate(() => handle().output.choose("")).catch(() => undefined);
      execFileSync("pactl", ["unload-module", module]);
    }
  });

  it.runIf(watcherPresent())("the tray item, its menu and a click", async () => {
    const items = execFileSync("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.kde.StatusNotifierWatcher",
      "--object-path",
      "/StatusNotifierWatcher",
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      "org.kde.StatusNotifierWatcher",
      "RegisteredStatusNotifierItems",
    ]).toString();
    const pid = app.process().pid!;
    const item = items
      .match(/'([^']+)'/g)
      ?.map((s) => s.slice(1, -1))
      .find((name) => {
        const bus = name.split("/")[0];
        try {
          const owner = execFileSync("gdbus", [
            "call",
            "--session",
            "--dest",
            "org.freedesktop.DBus",
            "--object-path",
            "/org/freedesktop/DBus",
            "--method",
            "org.freedesktop.DBus.GetConnectionUnixProcessID",
            bus,
          ]).toString();
          return owner.includes(String(pid));
        } catch {
          return false;
        }
      });
    expect(item).toBeDefined();
    const [bus, ...rest] = item!.split("/");
    const itemPath = `/${rest.join("/")}` === "/" ? "/StatusNotifierItem" : `/${rest.join("/")}`;
    const menuPath = execFileSync("gdbus", [
      "call",
      "--session",
      "--dest",
      bus,
      "--object-path",
      itemPath,
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      "org.kde.StatusNotifierItem",
      "Menu",
    ])
      .toString()
      .match(/'([^']+)'/)![1];
    for (const id of ["tray1", "tray2"]) await putTone(main, id, 20);
    await main.evaluate(([a, b]) => handle().engine.playList([a, b]), [track("tray1", 20), track("tray2", 20)]);
    const readLayout = () =>
      execFileSync("gdbus", [
        "call",
        "--session",
        "--dest",
        bus,
        "--object-path",
        menuPath,
        "--method",
        "com.canonical.dbusmenu.GetLayout",
        "0",
        "int32 -1",
        "@as []",
      ]).toString();
    await expect.poll(() => /'label': <'Pause'>/.test(readLayout())).toBe(true);
    const layout = readLayout();
    for (const label of ["Pause", "Next", "Previous", "Show Nuvo", "Quit Nuvo"]) expect(layout).toContain(label);
    expect(layout).toMatch(/'label': <'(Like|Unlike)'>/);
    const nextId = layout.match(/\((\d+), \{[^}]*'label': <'Next'>/)![1];
    const before = await main.evaluate(() => handle().engine.getView().index);
    execFileSync("gdbus", [
      "call",
      "--session",
      "--dest",
      bus,
      "--object-path",
      menuPath,
      "--method",
      "com.canonical.dbusmenu.Event",
      nextId,
      "clicked",
      "<0>",
      "0",
    ]);
    await expect.poll(() => main.evaluate(() => handle().engine.getView().index)).not.toBe(before);
  });

  it.runIf(process.env.NUVO_E2E_NETWORK === "1")(
    "twenty network tracks through path A leave the heap within 10 MB",
    async () => {
      const ids = (process.env.NUVO_E2E_TRACKS ?? "").split(",").filter(Boolean);
      expect(ids.length).toBeGreaterThanOrEqual(20);
      const heap = () =>
        main.evaluate(async () => {
          (globalThis as unknown as { gc?: () => void }).gc?.();
          return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
        });
      const start = await heap();
      for (const id of ids.slice(0, 20)) {
        await main.evaluate((t) => handle().engine.playList([t]), track(id, 200));
        await main.waitForFunction(() => handle().engine.getView().status === "playing", undefined, { timeout: 30_000 });
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
      expect((await heap()) - start).toBeLessThan(10 * 1024 * 1024);
    },
    15 * 60_000,
  );

  it("disposing the engine twice is safe and leaves no page error", async () => {
    const errorsBefore = problems.filter((text) => text.startsWith("pageerror")).length;
    const result = await main.evaluate(() => {
      try {
        handle().dispose();
        handle().dispose();
        return "ok";
      } catch (error) {
        return String(error);
      }
    });
    expect(result).toBe("ok");
    await main.waitForTimeout(500);
    expect(problems.filter((text) => text.startsWith("pageerror")).length).toBe(errorsBefore);
  });
});
