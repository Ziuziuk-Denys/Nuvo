import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";
import type { NotchAction, NotchSettings, NotchState } from "../src/notch/contracts";
import { ISLAND_SIZES, NOTCH_WINDOW, WING, islandRect, type IslandMode } from "../src/notch/lib/geometry";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARTIFACTS = path.join(ROOT, "e2e", "artifacts");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const NOTCH_TITLE = "Nuvo Notch";
// Must be on the command line: appendSwitch at runtime is too late for the platform choice.
const X11_FLAGS = ["--ozone-platform=x11"];

const SETTINGS: NotchSettings = {
  mode: "auto",
  expandOn: "hover",
  showLyrics: true,
  pulseOnTrackChange: true,
  display: "primary",
};

function playingState(status: NotchState["status"]): NotchState {
  return {
    track: {
      id: "t",
      title: "A very long test title that certainly overflows the island",
      artist: "Artist",
      coverUrl: null,
      durationMs: 200000,
    },
    status,
    positionMs: 1000,
    sampledAt: Date.now(),
    liked: false,
    upNext: [],
  };
}

/** The Notch state as the engine publishes it to main. */
function surfaceOf(state: NotchState) {
  return {
    trackId: state.track?.id ?? null,
    title: state.track?.title ?? "",
    artists: state.track?.artist ?? "",
    durationMs: state.track?.durationMs ?? 0,
    positionMs: state.positionMs,
    sampledAt: state.sampledAt,
    status: state.status,
    liked: state.liked,
    source: "youtube" as const,
    upNext: state.upNext.map((item) => ({ id: item.id, title: item.title, artist: item.artist, coverUrl: item.coverUrl ?? "", durationMs: item.durationMs })),
  };
}

/** What the page receives: the surface state, or the previous Notch state. */
const stateFor = (state: NotchState) => surfaceOf(state);

interface Launched {
  app: ElectronApplication;
  main: Page;
  profile: string;
  isolation?: Isolation;
}

async function launch(env: Record<string, string>, flags: string[] = []): Promise<Launched> {
  const isolation = isolate("nuvo-notch-e2e");
  const profile = isolation.work;
  const base = { ...isolation.env } as Record<string, string>;
  delete base.VITE_DEV_SERVER_URL;
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--mute-audio", `--user-data-dir=${path.join(profile, "user-data")}`, ...flags],
    cwd: ROOT,
    env: { ...base, ...env, XDG_CONFIG_HOME: profile },
  });
  const main = await waitForPage(app, (url) => !url.includes("#/notch"));
  await main.waitForFunction(() => Boolean(window.nuvoShell));
  return { app, main, profile, isolation };
}

async function close(launched: Launched | undefined): Promise<void> {
  if (!launched) return;
  const pid = launched.app.process().pid;
  await launched.app.close().catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  rmSync(launched.profile, { recursive: true, force: true });
  launched.isolation?.dispose();
}

async function waitForPage(app: ElectronApplication, match: (url: string) => boolean): Promise<Page> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((win) => match(win.url()));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("page did not appear");
}

const modeOf = (page: Page) => page.getAttribute(".island", "data-mode");

async function expectMode(page: Page, mode: IslandMode): Promise<void> {
  await expect.poll(() => modeOf(page), { timeout: 5_000 }).toBe(mode);
}

/** Waits until the island box is exactly the size for the mode, so the spring has settled. */
async function expectSize(page: Page, mode: IslandMode): Promise<void> {
  const size = ISLAND_SIZES[mode];
  await expect
    .poll(
      () =>
        page.$eval(".island", (el) => {
          const box = el.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      { timeout: 5_000 },
    )
    .toEqual({ width: size.width + WING * 2, height: size.height });
}

async function screenshot(page: Page, mode: IslandMode): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({
    path: path.join(ARTIFACTS, `notch-${mode}.png`),
    omitBackground: true,
  });
}

describe.skipIf(!process.env.DISPLAY)("Notch on X11", () => {
  let launched: Launched;
  let notch: Page;

  beforeAll(async () => {
    launched = await launch({}, X11_FLAGS);
    // The renderer sends its stored settings on mount and creates the Notch; ours are sent after, so they win.
    notch = await waitForPage(launched.app, (url) => url.includes("#/notch"));
    await notch.waitForSelector(".island");
    await launched.main.evaluate((settings) => window.nuvoShell!.notchUpdateSettings(settings), SETTINGS);
    await launched.app.evaluate(() => (globalThis as { nuvoNotch?: { ready: Promise<void> } }).nuvoNotch?.ready);
  });

  afterAll(() => close(launched));

  const setSettings = (settings: NotchSettings) => launched.main.evaluate((next) => window.nuvoShell!.notchUpdateSettings(next), settings);

  it("sits flush at the top center, above other windows", async () => {
    const display = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
    const notchWindow = () =>
      launched.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .map((w) => ({
            title: w.getTitle(),
            bounds: w.getBounds(),
            top: w.isAlwaysOnTop(),
            visible: w.isVisible(),
          }))
          .find((w) => w.title === "Nuvo Notch"),
      );
    await expect.poll(notchWindow).toEqual({
      title: NOTCH_TITLE,
      bounds: {
        x: display.x + Math.round((display.width - NOTCH_WINDOW.width) / 2),
        y: display.y,
        width: NOTCH_WINDOW.width,
        height: NOTCH_WINDOW.height,
      },
      top: true,
      visible: true,
    });
  });

  it("goes idle, live, hover, expanded and back to live", async () => {
    await expectMode(notch, "idle");
    await expectSize(notch, "idle");
    await screenshot(notch, "idle");

    await launched.main.evaluate((state) => window.nuvoShell!.sendPlayerState(state as never), stateFor(playingState("playing")));
    await launched.main.evaluate(() =>
      window.nuvoShell!.notchUpdateLyrics({
        trackId: "t",
        lines: [
          { timeMs: 0, text: "First line of the test lyrics" },
          { timeMs: 60_000, text: "The line that comes next" },
        ],
      }),
    );
    await expectMode(notch, "live");
    await expectSize(notch, "live");
    await screenshot(notch, "live");

    // The hover dwell (350 ms) ends before the spring rests, so the hover face is captured with click-to-expand.
    await setSettings({ ...SETTINGS, expandOn: "click" });
    await notch.hover(".island");
    await expectMode(notch, "hover");
    await expectSize(notch, "hover");
    await screenshot(notch, "hover");
    await notch.mouse.move(5, 230);
    await expectMode(notch, "live");

    await setSettings(SETTINGS);
    await notch.hover(".island");
    await expectMode(notch, "hover");
    await notch.waitForTimeout(400);
    await expectMode(notch, "expanded");
    await expectSize(notch, "expanded");
    await screenshot(notch, "expanded");

    await notch.mouse.move(5, 230);
    await notch.waitForTimeout(300);
    await expectMode(notch, "live");
  });

  it("shows a YouTube Music cover", async () => {
    // YouTube Music artwork, on the host its songs use now
    const cover = "https://yt3.googleusercontent.com/N55arCGj69gtw6thXK8JUPisxoVYiwuIEQ7I6SGlkEyNcSJ7xIWPe76Vuu1SiUqRyx5w9qvR_zV8fV3CWQ=w512-h512-l90-rj";
    await launched.main.evaluate((state) => window.nuvoShell!.sendPlayerState(state as never), { ...stateFor(playingState("playing")), publicCoverUrl: cover });
    const shown = () =>
      notch.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>("img.cover");
        return img ? { src: img.getAttribute("src"), loaded: img.complete && img.naturalWidth > 0 } : null;
      });
    await expect.poll(shown, { timeout: 15_000 }).toMatchObject({ loaded: true });
  });

  it("sends Notch actions to the main window", async () => {
    await launched.main.evaluate(() => {
      const target = window as unknown as { __notchActions: NotchAction[] };
      target.__notchActions = [];
      const listener = (action: NotchAction) => target.__notchActions.push(action);
      window.nuvoShell!.onRemoteCommand(listener as never);
    });
    await notch.hover(".island");
    await expectMode(notch, "expanded");
    await notch.click('button[aria-label="Next track"]');
    await expect
      .poll(() => launched.main.evaluate(() => (window as unknown as { __notchActions: NotchAction[] }).__notchActions))
      .toContainEqual({ type: "next" });
    await notch.mouse.move(5, 230);
    await expectMode(notch, "live");
  });

  it("limits the input region to the collapsed island", async () => {
    await expect
      .poll(() => launched.app.evaluate(() => (globalThis as { nuvoNotch?: { lastShape: unknown } }).nuvoNotch?.lastShape))
      .toEqual(islandRect(ISLAND_SIZES.live));
  });

  it("stays under 0.5% CPU while paused and collapsed", async () => {
    await launched.main.evaluate((state) => window.nuvoShell!.sendPlayerState(state as never), stateFor(playingState("paused")));
    await expectMode(notch, "live");
    const sample = () =>
      launched.app.evaluate(({ BrowserWindow, app }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Nuvo Notch");
        const pid = win?.webContents.getOSProcessId();
        return app.getAppMetrics().find((metric) => metric.pid === pid)?.cpu.percentCPUUsage ?? null;
      });
    await notch.waitForTimeout(1_000);
    await sample();
    await notch.waitForTimeout(10_000);
    const cpu = await sample();
    console.log(`[e2e] Notch renderer CPU over 10 s: ${cpu}%`);
    expect(cpu).not.toBeNull();
    expect(cpu!).toBeLessThan(0.5);
  });
});

/** A looped quiet tone with metadata, so Chromium publishes the page on MPRIS. */
async function playTone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rate = 8000;
    // Chromium treats media shorter than 5 s as one-shot sounds and keeps them out of the media session.
    const samples = rate * 6;
    const bytes = new Uint8Array(44 + samples);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples, true);
    text(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, "data");
    view.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) bytes[44 + i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * 440 * i) / rate));
    // blob: is in the media policy of both builds, data: is not
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })));
    audio.volume = 0.01;
    // Looped so the media session stays active while the test polls the bus.
    audio.loop = true;
    (window as unknown as { __tone: HTMLAudioElement }).__tone = audio;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "E2E tone",
      artist: "Nuvo tests",
    });
    await audio.play();
  });
}

const gnomeWayland = process.env.XDG_SESSION_TYPE === "wayland" && (process.env.XDG_CURRENT_DESKTOP ?? "").toUpperCase().includes("GNOME");

function gdbus(...args: string[]): string {
  return execFileSync("gdbus", ["call", "--session", ...args], {
    encoding: "utf8",
  });
}

function mprisNameFor(pids: Set<number>): string | null {
  const names = gdbus("--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.ListNames").match(
    /org\.mpris\.MediaPlayer2\.[\w.-]+/g,
  );
  for (const name of names ?? []) {
    const reply = gdbus(
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.GetConnectionUnixProcessID",
      name,
    );
    const pid = Number(reply.match(/uint32 (\d+)/)?.[1]);
    if (pids.has(pid)) return name;
  }
  return null;
}

function mprisProperties(name: string): string {
  return gdbus("--dest", name, "--object-path", "/org/mpris/MediaPlayer2", "--method", "org.freedesktop.DBus.Properties.GetAll", "org.mpris.MediaPlayer2");
}

describe.skipIf(!gnomeWayland)("GNOME Wayland default", () => {
  let launched: Launched;

  beforeAll(async () => {
    launched = await launch({});
  });

  afterAll(() => close(launched));

  it("creates no Notch window", async () => {
    await launched.main.evaluate((settings) => window.nuvoShell!.notchUpdateSettings(settings), SETTINGS);
    await launched.main.waitForTimeout(1_000);
    const titles = await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
    expect(titles).not.toContain(NOTCH_TITLE);
  });

  it("publishes MPRIS as Nuvo", async () => {
    await playTone(launched.main);

    const pids = new Set(await launched.app.evaluate(({ app }) => [process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]));
    let name: string | null = null;
    const deadline = Date.now() + 10_000;
    while (!name && Date.now() < deadline) {
      name = mprisNameFor(pids);
      if (!name) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const properties = name ? mprisProperties(name) : "";
    console.log(`[e2e] MPRIS ${name} ${properties.trim()}`);
    await launched.main.evaluate(() => (window as unknown as { __tone: HTMLAudioElement }).__tone.pause());

    expect(name).not.toBeNull();
    expect(properties).toContain("'Identity': <'Nuvo'>");
    // Electron 44's MPRIS service publishes no DesktopEntry at all; if a later version does, it must be nuvo.
    const desktopEntry = properties.match(/'DesktopEntry': <'([^']*)'>/)?.[1];
    if (desktopEntry !== undefined) expect(desktopEntry).toBe("nuvo");
  });
});

const hasBusTools = (() => {
  try {
    execFileSync("sh", ["-c", "command -v dbus-daemon && command -v gdbus"], { stdio: "ignore" });
    return process.platform === "linux";
  } catch {
    return false;
  }
})();

/** The panel widget's bus object on a private session bus: never the owner's bus, so no widget there sees the test. */
describe.skipIf(!hasBusTools)("Panel widget bus", () => {
  let launched: Launched;
  let daemon: ChildProcess;
  let busDir: string;
  let address: string;

  const busCall = (dest: string, objectPath: string, method: string, ...args: string[]) =>
    execFileSync("gdbus", ["call", "--session", "--dest", dest, "--object-path", objectPath, "--method", method, ...args], {
      encoding: "utf8",
      env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address },
    }).trim();
  const panelProps = () => busCall("quest.nuvo.Nuvo.Player", "/quest/nuvo/Nuvo/Player", "org.freedesktop.DBus.Properties.GetAll", "quest.nuvo.Nuvo.Player");

  beforeAll(async () => {
    const cache = path.join(homedir(), ".cache");
    mkdirSync(cache, { recursive: true });
    busDir = mkdtempSync(path.join(cache, "nuvo-e2e-bus-"));
    address = `unix:path=${path.join(busDir, "bus")}`;
    daemon = spawn("dbus-daemon", ["--session", "--nofork", "--nopidfile", `--address=${address}`, "--print-address"], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise<void>((resolve) => daemon.stdout!.once("data", () => resolve()));
    launched = await launch({ DBUS_SESSION_BUS_ADDRESS: address });
  });

  afterAll(async () => {
    await close(launched);
    daemon?.kill();
    rmSync(busDir, { recursive: true, force: true });
  });

  it("owns quest.nuvo.Nuvo.Player and names the MPRIS player Chromium publishes", async () => {
    await expect.poll(() => panelProps(), { timeout: 15_000 }).toContain("'MprisName'");
    const mainPid = await launched.app.evaluate(() => process.pid);
    expect(panelProps()).toContain(`'MprisName': <'org.mpris.MediaPlayer2.chromium.instance${mainPid}'>`);
    await playTone(launched.main);
    await expect
      .poll(
        () =>
          busCall(
            `org.mpris.MediaPlayer2.chromium.instance${mainPid}`,
            "/org/mpris/MediaPlayer2",
            "org.freedesktop.DBus.Properties.Get",
            "org.mpris.MediaPlayer2",
            "Identity",
          ),
        {
          timeout: 10_000,
        },
      )
      .toBe("(<'Nuvo'>,)");
    await launched.main.evaluate(() => (window as unknown as { __tone: HTMLAudioElement }).__tone.pause());
  });

  it("carries the like state and the lyrics line, and turns its methods into player commands", async () => {
    const state = playingState("playing");
    await launched.main.evaluate(
      ({ surface, lyrics }) => {
        const sent: unknown[] = [];
        (window as unknown as { __commands: unknown[] }).__commands = sent;
        window.nuvoShell!.onRemoteCommand((command) => sent.push(command));
        window.nuvoShell!.notchUpdateLyrics(lyrics);
        window.nuvoShell!.sendPlayerState({ ...surface, liked: true, sampledAt: Date.now() });
      },
      {
        surface: surfaceOf(state),
        lyrics: {
          trackId: "t",
          lines: [
            { timeMs: 0, text: "First line" },
            { timeMs: 600_000, text: "Later" },
          ],
        },
      },
    );
    await expect.poll(() => panelProps(), { timeout: 5_000 }).toContain("'LyricsLine': <'First line'>");
    expect(panelProps()).toContain("'Liked': <true>");
    busCall("quest.nuvo.Nuvo.Player", "/quest/nuvo/Nuvo/Player", "quest.nuvo.Nuvo.Player.ToggleLike");
    busCall("quest.nuvo.Nuvo.Player", "/quest/nuvo/Nuvo/Player", "quest.nuvo.Nuvo.Player.Dislike");
    await expect
      .poll(() => launched.main.evaluate(() => (window as unknown as { __commands: unknown[] }).__commands), { timeout: 5_000 })
      .toEqual([{ type: "unlike" }, { type: "dislike" }]);
  });

  it("reports the panel widget for this desktop to Settings and shows its row", async () => {
    const status = await launched.main.evaluate(() => window.nuvoShell!.getPanelStatus());
    const desktop = (process.env.XDG_CURRENT_DESKTOP ?? "").toUpperCase();
    const expected = desktop.includes("GNOME") ? "gnome" : desktop.includes("KDE") ? "plasma" : status.session === "x11" ? null : "waybar";
    expect(status.panel?.target ?? null).toBe(expected);
    if (!expected) return;
    await launched.main.evaluate(() => (location.hash = "#/settings?section=notch"));
    // a profile with moved XDG folders never gets the one-click install, only the manual steps
    const shown = launched.main.locator(status.panel!.manual ? '[data-testid="panel-note"]' : '[data-testid="panel-install"]');
    await shown.waitFor({ timeout: 10_000 });
    if (status.panel!.manual) expect(await launched.main.locator('[data-testid="panel-install"]').count()).toBe(0);
    const text = await launched.main.locator("[role=dialog]").innerText();
    expect(text).toContain(status.supported ? "Panel widget" : "Use the panel widget instead");
    mkdirSync(ARTIFACTS, { recursive: true });
    await launched.main.screenshot({ path: path.join(ARTIFACTS, "settings-panel-widget.png") });
  });
});
