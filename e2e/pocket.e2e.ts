import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PocketWindow } from "../electron/pocket/window";
import { POCKET_SIZES } from "../src/pocket/contracts";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const MARGIN = 10;

const STATE = {
  trackId: "t",
  title: "Test song",
  artists: "Artist",
  durationMs: 200_000,
  positionMs: 11_000,
  sampledAt: 0,
  status: "playing" as const,
  liked: false,
  source: "youtube" as const,
  upNext: [{ id: "n", title: "Next song", artist: "Artist", coverUrl: "", durationMs: 1000 }],
};

async function waitForPage(app: ElectronApplication, match: (url: string) => boolean): Promise<Page> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((win) => match(win.url()));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("page did not appear");
}

describe.skipIf(!process.env.DISPLAY)("Pocket player on X11", () => {
  let isolation: Isolation;
  let app: ElectronApplication;
  let main: Page;
  let pocket: Page;

  const open = async () => {
    await main.evaluate(() => window.nuvoShell!.togglePocket());
    const page = await waitForPage(app, (url) => url.includes("#/pocket"));
    await page.waitForSelector(".pocket");
    return page;
  };
  const inMain = <T>(read: "bounds" | "onTop" | "open") =>
    app.evaluate(({ BrowserWindow }, key) => {
      const held = (globalThis as unknown as { nuvoPocket: PocketWindow }).nuvoPocket;
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents === held.webContents);
      return key === "bounds" ? win?.getBounds() : key === "onTop" ? win?.isAlwaysOnTop() : held.isOpen;
    }, read) as Promise<T>;

  beforeAll(async () => {
    isolation = isolate("nuvo-pocket-e2e");
    const env = { ...isolation.env } as Record<string, string>;
    delete env.VITE_DEV_SERVER_URL;
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [ROOT, "--mute-audio", `--user-data-dir=${path.join(isolation.work, "user-data")}`, "--ozone-platform=x11"],
      cwd: ROOT,
      env: { ...env, XDG_CONFIG_HOME: isolation.work, XDG_SESSION_TYPE: "x11" },
    });
    main = await waitForPage(app, (url) => !url.includes("#/"));
    await main.waitForFunction(() => Boolean(window.nuvoShell));
    pocket = await open();
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    if (isolation) rmSync(isolation.work, { recursive: true, force: true });
    isolation?.dispose();
  });

  it("opens square, above the other windows, and shows the song", async () => {
    const bounds = await inMain<{ width: number; height: number }>("bounds");
    expect([bounds.width, bounds.height]).toEqual([POCKET_SIZES.medium + MARGIN * 2, POCKET_SIZES.medium + MARGIN * 2]);
    await expect.poll(() => inMain<boolean>("onTop"), { timeout: 5_000 }).toBe(true);
    await main.evaluate((state) => window.nuvoShell!.sendPlayerState({ ...state, sampledAt: Date.now() }), STATE);
    await expect.poll(() => pocket.textContent(".now-title"), { timeout: 5_000 }).toBe("Test song");
  });

  it("shows the controls under the pointer and puts them away after it leaves", async () => {
    const mode = () => pocket.getAttribute(".pocket", "data-awake");
    await pocket.mouse.move(160, 160);
    await expect.poll(mode, { timeout: 3_000 }).toBe("true");
    await pocket.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent("mouseleave", { clientX: 0, clientY: 160 })));
    await expect.poll(mode, { timeout: 3_000 }).toBe("false");
  });

  it("has one drag layer, and every control comes after it", async () => {
    await pocket.mouse.move(150, 150);
    await expect.poll(() => pocket.getAttribute(".pocket", "data-awake"), { timeout: 3_000 }).toBe("true");
    const regions = await pocket.evaluate(() =>
      [...document.querySelectorAll(".pocket *")].flatMap((element) =>
        ["", "::before", "::after"]
          .filter((part) => part === "" || getComputedStyle(element, part).content !== "none")
          .map((part) => getComputedStyle(element, part).getPropertyValue("-webkit-app-region"))
          .filter((region) => region === "drag" || region === "no-drag"),
      ),
    );
    expect(regions.filter((region) => region === "drag")).toHaveLength(1);
    expect(regions[0]).toBe("drag");
    expect(regions.length).toBeGreaterThan(8);
  });

  it("turns over to the lyrics and the queue by key", async () => {
    await main.evaluate(() =>
      window.nuvoShell!.notchUpdateLyrics({
        trackId: "t",
        lines: [
          { timeMs: 1000, text: "First line" },
          {
            timeMs: 9000,
            text: "Second line",
            words: [
              { timeMs: 9000, text: "Second " },
              { timeMs: 10_000, text: "line" },
            ],
          },
        ],
      }),
    );
    const face = () => pocket.getAttribute(".pocket", "data-face");
    await pocket.keyboard.press("l");
    await expect.poll(face).toBe("lyrics");
    await expect.poll(() => pocket.textContent("[data-at=now]"), { timeout: 5_000 }).toBe("Second line");
    await pocket.keyboard.press("q");
    await expect.poll(face).toBe("queue");
    expect(await pocket.textContent(".queue-row")).toContain("Next song");
    await pocket.keyboard.press("Escape");
    await expect.poll(face).toBe("cover");
  });

  it("closes and opens again at the size it had", async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const held = (globalThis as unknown as { nuvoPocket: PocketWindow }).nuvoPocket;
      BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents === held.webContents)
        ?.setSize(272, 272);
    });
    await expect.poll(async () => (await inMain<{ width: number }>("bounds")).width, { timeout: 5_000 }).toBe(272);
    await pocket.keyboard.press("Control+w").catch(() => undefined);
    await expect.poll(() => inMain<boolean>("open"), { timeout: 5_000 }).toBe(false);
    pocket = await open();
    await expect.poll(async () => (await inMain<{ width: number }>("bounds")).width, { timeout: 5_000 }).toBe(272);
  });
});
