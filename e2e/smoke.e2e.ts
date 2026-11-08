import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { clearTestKeyring, testKeyringService } from "../scripts/bench/keyring.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const KEYRING_SERVICE: string = testKeyringService();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-smoke-"));
// unix socket paths are limited to 108 bytes; keep it short and away from the real one
const socketDir = path.join(process.env.XDG_RUNTIME_DIR ?? os.tmpdir(), `nuvo-smoke-${process.pid}`);
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
const TRACK = {
  id: "fJ9rUzIMcZQ",
  title: "Bohemian Rhapsody",
  artists: [{ id: "UCiMhD4jzUqG-IgPzUmmytRQ", name: "Queen" }],
  durationMs: 354_000,
};

let app: ElectronApplication | null = null;
const requested: string[] = [];

/** Hosts of the services Nuvo talks to; any other remote request would be a privacy leak. */
const KNOWN_HOSTS = [
  "youtube.com",
  "googlevideo.com",
  "ytimg.com",
  "googleusercontent.com",
  "ggpht.com",
  "sndcdn.com",
  "soundcloud.com",
  "soundcloud.cloud",
  "apple.com",
  "deezer.com",
  "yandex.net",
];
const isKnownHost = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || KNOWN_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [ROOT, `--user-data-dir=${path.join(work, "user-data")}`, "--mute-audio"],
    cwd: ROOT,
    env,
  });
  await app.evaluate(({ session }) => {
    const urls: string[] = [];
    (globalThis as { __urls?: string[] }).__urls = urls;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      urls.push(details.url);
      callback({});
    });
  });
  const deadline = Date.now() + 30_000;
  let page: Page | undefined;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((win) => !win.url().includes("#/notch"));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error("main window did not appear");
  page.on("request", (request) => requested.push(request.url()));
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function close() {
  if (!app) return;
  const launched = app;
  app = null;
  requested.push(...(await launched.evaluate(() => (globalThis as { __urls?: string[] }).__urls ?? [])));
  const pid = launched.process().pid;
  await launched.close().catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function core(page: Page, script: string): Promise<unknown> {
  return page.evaluate(`(async () => { const base = "nuvo-core://local"; const json = { "Content-Type": "application/json" }; ${script} })()`);
}

afterEach(close);

afterAll(async () => {
  await close();
  clearTestKeyring(KEYRING_SERVICE);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(socketDir, { recursive: true, force: true });
});

describe("Nuvo with nuvo-core", () => {
  it("first run: no login, phrase once, library writes, lyrics", async () => {
    // fail loudly instead of passing silently when the lyrics provider cannot be reached
    const probe = await fetch("https://lrclib.net/api/get?track_name=Bohemian%20Rhapsody&artist_name=Queen&duration=354").catch((error: unknown) => {
      throw new Error(`LRCLIB is unreachable, lyrics check cannot run: ${String(error)}`);
    });
    expect(probe.status, "LRCLIB must answer for the lyrics check").toBe(200);

    const page = await launch();
    await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
    expect(await page.locator("[data-testid=recovery-word]").count()).toBe(24);
    await page.getByRole("button", { name: "I wrote it down" }).click();
    // the tour starts after the phrase: skip it, then close its short version
    await page.getByRole("button", { name: "Skip the tour", exact: true }).click({ timeout: 30_000 });
    await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 30_000 });
    expect(page.url()).not.toContain("#/login");
    // the Home has no liked tile, so wait for the navigation rail
    await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });

    await core(
      page,
      `const track = ${JSON.stringify(TRACK)};
       await fetch(base + "/v1/me/library/tracks/" + track.id, { method: "PUT", headers: json, body: JSON.stringify({ track }) });
       const playlist = await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: "E2E Playlist" }) }).then((r) => r.json());
       await fetch(base + "/v1/me/playlists/" + playlist.id + "/tracks/" + track.id, { method: "POST", headers: json, body: JSON.stringify({ track }) });`,
    );
    // the writes bypass the UI cache, so reload to make the renderer read them
    await page.evaluate(() => {
      location.hash = "#/library";
    });
    await page.reload();
    await page.getByText("E2E Playlist").first().waitFor({ timeout: 15_000 });

    const lyrics = (await core(
      page,
      `return await fetch(base + "/v1/tracks/${TRACK.id}/lyrics?title=Bohemian%20Rhapsody&artist=Queen&durationMs=354000").then((r) => r.text());`,
    )) as string;
    expect(lyrics).toContain('"status":"found"');
    await close();
    expect(fs.existsSync(env.NUVO_CORE_SOCKET)).toBe(false);
  });

  it("second run: data persists, no phrase step, nothing went to a blocked host", async () => {
    const page = await launch();
    await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    expect(await page.locator("[data-testid=recovery-word]").count()).toBe(0);

    const state = (await core(
      page,
      `const liked = await fetch(base + "/v1/me/library/tracks").then((r) => r.json());
       const playlists = await fetch(base + "/v1/me/playlists").then((r) => r.json());
       return { liked: liked.items.map((i) => i.track.id), playlists: playlists.items.map((p) => p.title) };`,
    )) as { liked: string[]; playlists: string[] };
    expect(state.liked).toEqual([TRACK.id]);
    expect(state.playlists).toEqual(["E2E Playlist"]);
    await close();

    const remote = requested.filter((url) => /^(https?|wss?):/.test(url)).map((url) => new URL(url).hostname);
    expect(remote.filter((host) => !isKnownHost(host))).toEqual([]);

    const db = path.join(work, "data", "nuvo", "library.db");
    expect(fs.readFileSync(db).subarray(0, 15).toString()).not.toBe("SQLite format 3");
    expect(() =>
      execFileSync("sqlite3", [db, "SELECT count(*) FROM tracks"], {
        stdio: "pipe",
      }),
    ).toThrow();
  });
});
