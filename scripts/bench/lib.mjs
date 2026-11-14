import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { _electron as electron } from "playwright-core";
import { clearTestKeyring, testKeyringService } from "./keyring.mjs";
import { median, parseStat, percentile, readKb, round, toneWav } from "./stats.mjs";

export { median, percentile, round };

export const ROOT = path.resolve(import.meta.dirname, "../..");
const CLOCK_TICKS = 100;

export function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Temp dirs and test keyring: the owner's profile, library and nuvo-core key stay untouched
export function createProfile(name) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `nuvo-bench-${name}-`));
  const keyringService = testKeyringService();
  // unix socket paths are limited to 108 bytes
  const runtime = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  fs.mkdirSync(runtime, { recursive: true });
  const socketDir = fs.mkdtempSync(path.join(runtime, "nuvo-bench-"));
  const env = {
    ...process.env,
    XDG_DATA_HOME: path.join(work, "data"),
    XDG_CACHE_HOME: path.join(work, "cache"),
    XDG_STATE_HOME: path.join(work, "state"),
    XDG_CONFIG_HOME: path.join(work, "config"),
    NUVO_CORE_SOCKET: path.join(socketDir, "core.sock"),
    NUVO_CORE_KEYRING_SERVICE: keyringService,
  };
  delete env.VITE_DEV_SERVER_URL;
  return {
    env,
    userDataDir: path.join(work, "user-data"),
    remove() {
      clearTestKeyring(keyringService);
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(socketDir, { recursive: true, force: true });
    },
  };
}

export async function launch(profile, exe) {
  const startedAt = Date.now();
  const app = await electron.launch({
    executablePath: exe,
    args: [...(exe ? [] : [ROOT]), `--user-data-dir=${profile.userDataDir}`],
    cwd: ROOT,
    env: profile.env,
  });
  const deadline = Date.now() + 30_000;
  let page;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((win) => !win.url().includes("#/notch"));
    if (!page) await sleep(50);
  }
  if (!page) throw new Error("main window did not appear");
  const visibleAt = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const check = () => {
          if (document.visibilityState === "visible" && document.body.innerText.trim().length > 0) {
            resolve(performance.timeOrigin + performance.now());
          } else requestAnimationFrame(check);
        };
        check();
      }),
  );
  return { app, page, pid: app.process().pid, startedAt, startMs: visibleAt - startedAt };
}

export async function close(app) {
  const pid = app.process().pid;
  await app.close().catch(() => undefined);
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

export function processTree(rootPid) {
  const parents = new Map();
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      parents.set(Number(entry), parseStat(fs.readFileSync(`/proc/${entry}/stat`, "utf8")).parent);
    } catch {}
  }
  const tree = [rootPid];
  for (let i = 0; i < tree.length; i++) {
    for (const [pid, parent] of parents) if (parent === tree[i]) tree.push(pid);
  }
  return tree;
}

function processKind(pid) {
  // forked Chromium children rewrite argv as one space-joined string
  const args = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/);
  const type = args.find((arg) => arg.startsWith("--type="));
  if (type) {
    const kind = type.slice("--type=".length);
    if (kind !== "utility") return kind;
    const sub = args.find((arg) => arg.startsWith("--utility-sub-type="));
    return sub ? `utility:${sub.split("=")[1].split(".").pop()}` : kind;
  }
  return path.basename(args[0]) === "nuvo-core" ? "core" : "main";
}

// Only anon PSS compares across sessions; file-backed PSS moves with shared library mappings
export function memory(rootPid) {
  const byKind = {};
  const counts = {};
  let total = 0;
  let anon = 0;
  for (const pid of processTree(rootPid)) {
    try {
      const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      const pss = readKb(rollup, "Pss") / 1024;
      const kind = processKind(pid);
      byKind[kind] = (byKind[kind] ?? 0) + pss;
      counts[kind] = (counts[kind] ?? 0) + 1;
      total += pss;
      anon += readKb(rollup, "Pss_Anon") / 1024;
    } catch {}
  }
  return { total, anon, byKind, counts };
}

function cpuTicks(rootPid) {
  let ticks = 0;
  for (const pid of processTree(rootPid)) {
    try {
      ticks += parseStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8")).ticks;
    } catch {}
  }
  return ticks;
}

export async function cpuPercent(rootPid, seconds) {
  const before = cpuTicks(rootPid);
  await sleep(seconds * 1000);
  return ((cpuTicks(rootPid) - before) / CLOCK_TICKS / seconds) * 100;
}

export const TRACKS = 5_000;
export const ALBUMS = 5_000;

export function core(page, script, arg) {
  return page.evaluate(
    ({ script, arg }) =>
      new Function("base", "json", "arg", `return (async () => { ${script} })()`)("nuvo-core://local", { "Content-Type": "application/json" }, arg),
    { script, arg },
  );
}

export async function passFirstRun(page) {
  await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "I wrote it down" }).click();
  // Skip the tour and close its short version, or its layer sits over the rows
  await page.getByRole("button", { name: "Skip the tour", exact: true }).click({ timeout: 30_000 });
  await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 30_000 });
  await page.locator("[data-tour-layer]").waitFor({ state: "detached", timeout: 10_000 });
  await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
}

// A profile without plays has no mixes, so the cold-start slot marks Home drawn too
export function homeReady(page) {
  return page.locator("[data-mix], [data-slot=cold-start]").first().waitFor({ timeout: 30_000 });
}

async function seedData(page) {
  return core(
    page,
    `const tracks = Array.from({ length: ${TRACKS} }, (_, i) => ({
       id: "bench-" + String(i).padStart(4, "0"),
       title: "Track " + i,
       artists: [{ id: "artist-" + (i % 50), name: "Artist " + (i % 50) }],
       durationMs: 180000,
       coverUrl: "",
       album: { id: "album-" + (i % 20), title: "Album " + (i % 20) },
     }));
     const playlist = await (await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: "Big playlist" }) })).json();
     for (let start = 0; start < tracks.length; start += 500) {
       const res = await fetch(base + "/v1/me/playlists/" + playlist.id + "/tracks", { method: "POST", headers: json, body: JSON.stringify({ tracks: tracks.slice(start, start + 500) }) });
       if (!res.ok) throw new Error("playlist " + res.status);
     }
     for (let start = 0; start < ${ALBUMS}; start += 100) {
       const batch = [];
       for (let i = start; i < Math.min(start + 100, ${ALBUMS}); i += 1) {
         const snapshot = { id: "bench-album-" + String(i).padStart(5, "0"), title: "Album " + (i + 1), author: "Artist " + (i % 400), cover: { url: "" }, trackCount: 8 + (i % 12) };
         batch.push(fetch(base + "/v1/me/library/albums/" + snapshot.id, { method: "PUT", headers: json, body: JSON.stringify({ snapshot }) }).then((res) => { if (!res.ok) throw new Error("album " + res.status); }));
       }
       await Promise.all(batch);
     }
     return playlist.id;`,
  );
}

export async function seedProfile(profile, exe, { data = false } = {}) {
  const { app, page } = await launch(profile, exe);
  await passFirstRun(page);
  if (data) profile.playlistId = await seedData(page);
  await sleep(2_000);
  await close(app);
}

export async function enableHandle(page) {
  await page.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__nuvoPlayer), null, { timeout: 30_000 });
}

export async function putTone(page, id, seconds, rate = 16_000) {
  const wav = toneWav(seconds, rate).toString("base64");
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
  if (status >= 300) throw new Error(`cache put ${id}: ${status}`);
}

export async function openPlaylist(page, id) {
  await page.evaluate((id) => (location.hash = `#/library/playlist?id=${id}`), id);
  await page.locator("[data-track-row]").first().waitFor({ timeout: 30_000 });
}
