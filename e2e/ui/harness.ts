import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import type { PresetId } from "../../src/data/look/presets";
import { clearTestKeyring, testKeyringService } from "../../scripts/bench/keyring.mjs";
import { seedLibrary, serveFixtureCovers, type SeedReport } from "./seed";

export interface Look {
  preset: PresetId;
  mode: "light" | "dark";
}
export interface Size {
  width: number;
  height: number;
}

export const MATRIX: Look[] = [
  { preset: "nuvo", mode: "light" },
  { preset: "nuvo", mode: "dark" },
  { preset: "frost", mode: "dark" },
  { preset: "amber", mode: "dark" },
  { preset: "ink", mode: "light" },
  { preset: "dusk", mode: "light" },
];
export const SIZES: Size[] = [
  { width: 1200, height: 780 },
  { width: 1100, height: 705 },
];

export interface ShootOptions {
  looks?: Look[];
  sizes?: Size[];
  motion?: boolean;
  prepare?: () => Promise<void>;
}

export interface NuvoSession {
  app: ElectronApplication;
  page: Page;
  go(hash: string): Promise<void>;
  setLook(look: Look): Promise<void>;
  setSize(size: Size): Promise<void>;
  shoot(step: string, screen: string, state: string, options?: ShootOptions): Promise<string[]>;
  core(script: string): Promise<unknown>;
  seed?: SeedReport;
  close(): Promise<void>;
}

export const RECORDING = process.env.NUVO_E2E_RECORD === "1";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ARTIFACTS = path.join(ROOT, "e2e", "artifacts", "ui");
// one service per run: a parallel run from another worktree never clears the key this run is using
const KEYRING_SERVICE: string = testKeyringService();
let openSessions = 0;

export function clearKeyring(): void {
  clearTestKeyring(KEYRING_SERVICE);
}

export async function passFirstRun(page: Page): Promise<void> {
  await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
  if ((await page.locator("[data-testid=recovery-word]").count()) !== 24) {
    throw new Error("expected 24 recovery words");
  }
  await page.getByRole("button", { name: "I wrote it down" }).click();
  await page.getByRole("button", { name: "Skip the tour", exact: true }).click({ timeout: 30_000 });
  await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 30_000 });
  await page.locator("[data-tour-layer]").waitFor({ state: "detached", timeout: 10_000 });
  await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
}

export async function launchNuvo(options: { profile: "fresh" | "seeded"; locale?: "en" | "ru"; args?: string[] }): Promise<NuvoSession> {
  // a fresh profile only shows the phrase step when the keyring holds no key
  if (openSessions === 0) clearKeyring();
  openSessions += 1;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-ui-"));
  // unix socket paths are limited to 108 bytes; keep it short and away from the real one
  const socketDir = path.join(process.env.XDG_RUNTIME_DIR ?? os.tmpdir(), `nuvo-ui-${process.pid}-${openSessions}`);
  fs.mkdirSync(socketDir, { recursive: true });
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_DATA_HOME: path.join(work, "data"),
    XDG_CACHE_HOME: path.join(work, "cache"),
    XDG_STATE_HOME: path.join(work, "state"),
    XDG_CONFIG_HOME: path.join(work, "config"),
    NUVO_CORE_SOCKET: path.join(socketDir, "core.sock"),
    NUVO_CORE_KEYRING_SERVICE: KEYRING_SERVICE,
  };
  delete env.VITE_DEV_SERVER_URL;

  let started: ElectronApplication | undefined;
  try {
    const app = await electron.launch({
      args: [ROOT, "--mute-audio", `--user-data-dir=${path.join(work, "user-data")}`, ...(options.args ?? [])],
      cwd: ROOT,
      env,
    });
    started = app;
    const deadline = Date.now() + 30_000;
    let page: Page | undefined;
    while (!page && Date.now() < deadline) {
      page = app.windows().find((win) => !win.url().includes("#/notch"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!page) throw new Error("main window did not appear");
    const main = page;
    await main.waitForLoadState("domcontentloaded");
    // the seeded covers come from a loopback server the app's image policy rightly refuses; only this test page lets them in
    const cdp = await main.context().newCDPSession(main);
    await cdp.send("Page.setBypassCSP", { enabled: true });
    await serveFixtureCovers(main);

    let currentLook: Look | null = null;
    let closed = false;

    const session: NuvoSession = {
      app,
      page: main,

      async go(hash) {
        await main.evaluate((value) => {
          location.hash = value;
        }, hash);
        await main.waitForTimeout(500);
      },

      async setLook(look) {
        // pending debounced store writes flush every second and would overwrite the blob below
        await main.waitForTimeout(1_100);
        await main.evaluate((value) => {
          const key = "nuvo.look.v1";
          const stored = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":1}');
          stored.state.preset = value.preset;
          localStorage.setItem(key, JSON.stringify(stored));
          localStorage.setItem("theme", value.mode);
        }, look);
        await main.reload();
        await main.waitForFunction(
          (value) => document.documentElement.dataset.preset === value.preset && document.documentElement.getAttribute("data-theme") === value.mode,
          look,
          { timeout: 30_000 },
        );
        await main.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, undefined, { timeout: 30_000 });
        currentLook = look;
      },

      async setSize(size) {
        await app.evaluate(({ BrowserWindow }, value) => {
          const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("file:") && !w.webContents.getURL().includes("#/notch"));
          if (!win) throw new Error("no main window");
          if (win.isMaximized()) win.unmaximize();
          win.setSize(value.width, value.height);
        }, size);
        await main.waitForTimeout(300);
      },

      async shoot(step, screen, state, shootOptions = {}) {
        const looks = shootOptions.looks ?? MATRIX;
        const sizes = shootOptions.sizes ?? SIZES;
        const dir = path.join(ARTIFACTS, step);
        fs.mkdirSync(dir, { recursive: true });
        const files: string[] = [];
        for (const look of looks) {
          const changed = !currentLook || currentLook.preset !== look.preset || currentLook.mode !== look.mode;
          if (changed) {
            await session.setLook(look);
            await shootOptions.prepare?.();
          } else if (files.length === 0) {
            await shootOptions.prepare?.();
          }
          for (const size of sizes) {
            await session.setSize(size);
            await main.emulateMedia({ reducedMotion: shootOptions.motion ? "no-preference" : "reduce" });
            await main.evaluate(() => document.fonts.ready.then(() => undefined));
            await main.waitForTimeout(800);
            const file = path.join(dir, `${screen}-${state}-${look.preset}-${look.mode}-${size.width}.png`);
            await main.screenshot({ path: file });
            files.push(file);
          }
        }
        return files;
      },

      core(script) {
        return main.evaluate(`(async () => { const base = "nuvo-core://local"; const json = { "Content-Type": "application/json" }; ${script} })()`);
      },

      async close() {
        if (closed) return;
        closed = true;
        const pid = app.process().pid;
        await app.close().catch(() => undefined);
        if (pid) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(socketDir, { recursive: true, force: true });
        openSessions -= 1;
        if (openSessions === 0) clearKeyring();
      },
    };

    if (options.locale) {
      await main.evaluate((locale) => localStorage.setItem("nuvo_locale", locale), options.locale);
      await main.reload();
      await main.waitForLoadState("domcontentloaded");
    }
    if (options.profile === "seeded") {
      await passFirstRun(main);
      session.seed = await seedLibrary(session);
      await main.waitForTimeout(1_100);
      await main.reload();
      await main.waitForLoadState("domcontentloaded");
    }
    return session;
  } catch (error) {
    await started?.close().catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(socketDir, { recursive: true, force: true });
    openSessions -= 1;
    if (openSessions === 0) clearKeyring();
    throw error;
  }
}
