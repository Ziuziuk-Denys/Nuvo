import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const SHOTS = path.join(os.homedir(), ".cache", "lyrics-shots");
const SONG = { id: "fixture-song", title: "Morning Light", artists: "Nova", coverUrl: "", durationMs: 30_000 };
const SYNCED = "[00:01.00]Morning light\n[00:04.00]Over the hill\n[00:07.00]Where the river runs\n[00:10.00]Home again";

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;
let provider: http.Server;

function toneWav(seconds: number): Buffer {
  const rate = 48_000;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 4000), i * 2);
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

beforeAll(async () => {
  provider = http.createServer((request, response) => {
    const record = {
      id: 1,
      trackName: SONG.title,
      artistName: SONG.artists,
      duration: SONG.durationMs / 1000,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: SYNCED,
    };
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/api/get")) response.end(JSON.stringify(record));
    else if (request.url?.startsWith("/api/search")) response.end(JSON.stringify([record]));
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const { port } = provider.address() as { port: number };
  isolation = isolate("nuvo-lyrics-e2e");
  isolation.env.NUVO_CORE_LRCLIB_URL = `http://127.0.0.1:${port}`;
  app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--ozone-platform=x11", "--mute-audio", `--user-data-dir=${isolation.userData}`],
    cwd: ROOT,
    env: isolation.env,
  });
  main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.nuvoShell));
  await main.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics), undefined, { timeout: 60_000 });
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
  provider?.close();
  isolation?.dispose();
});

it("a playing fixture song moves the active line", async () => {
  const wav = toneWav(30).toString("base64");
  const status = await main.evaluate(
    async ({ id, wav }) => {
      const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
      const response = await fetch(`nuvo-core://local/v1/cache/audio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "audio/wav", "X-Nuvo-Codec": "pcm" },
        body: bytes,
      });
      return response.status;
    },
    { id: SONG.id, wav },
  );
  expect(status).toBeLessThan(300);

  // a view must subscribe for the active-line loop to run; the Notch feed in the app does
  await main.evaluate(
    (song) => (window as unknown as { __nuvoPlayer: { engine: { playList(tracks: unknown[]): void } } }).__nuvoPlayer.engine.playList([song]),
    SONG,
  );
  const read = () =>
    main.evaluate(() => {
      const state = (
        window as unknown as { __nuvoLyrics: { getState(): { status: string; trackId: string | null; currentLine: number | null; lines: unknown[] } } }
      ).__nuvoLyrics.getState();
      return { status: state.status, trackId: state.trackId, currentLine: state.currentLine, lines: state.lines.length };
    });

  await expect.poll(async () => (await read()).status, { timeout: 20_000 }).toBe("ready");
  expect(await read()).toMatchObject({ trackId: SONG.id, lines: 4 });
  const seen: number[] = [];
  await expect
    .poll(
      async () => {
        const { currentLine } = await read();
        if (currentLine !== null && seen.at(-1) !== currentLine) seen.push(currentLine);
        return seen;
      },
      { timeout: 20_000, interval: 250 },
    )
    .toEqual(expect.arrayContaining([0, 1]));
  expect(seen).toEqual([...seen].sort((a, b) => a - b));

  fs.mkdirSync(SHOTS, { recursive: true });
  const notch = app.windows().find((win) => win.url().includes("#/notch"));
  if (notch) {
    await notch.hover(".island");
    await notch.waitForTimeout(1_200);
  }
  await (notch ?? main).screenshot({ path: path.join(SHOTS, "active-line.png") });
});

it("the karaoke view of a paused, restored song shows its line in full ink, the rest dim", async () => {
  type Player = { engine: { pause(): void; seekTo(ms: number): void } };
  await main.evaluate(() => {
    const { engine } = (window as unknown as { __nuvoPlayer: Player }).__nuvoPlayer;
    engine.pause();
    engine.seekTo(5_500);
  });
  await main.waitForTimeout(1_500);
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoLyrics?: unknown }).__nuvoLyrics), undefined, { timeout: 60_000 });
  await main.evaluate(() => {
    location.hash = "#/player";
  });
  const lines = main.locator("braccato-lyrics .blyrics--line");
  await expect.poll(() => lines.count(), { timeout: 30_000 }).toBe(4);
  await main.locator("braccato-lyrics .blyrics--line[data-nuvo-now]").waitFor({ timeout: 10_000 });
  await main.waitForTimeout(1_000);
  const look = await main.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("braccato-lyrics .blyrics--line")].map((line) => ({
      line: Number(line.dataset.lineNumber),
      active: line.hasAttribute("data-nuvo-now"),
      color: getComputedStyle(line.querySelector(".blyrics--word:not(.blyrics-word-highlight)")!).color,
    })),
  );
  const [active, ...more] = look.filter((line) => line.active);
  expect(more).toEqual([]);
  expect(active.line).toBe(1);
  for (const line of look.filter((other) => !other.active)) {
    expect(line.color, `line ${line.line}`).not.toBe(active.color);
  }
  await main.screenshot({ path: path.join(SHOTS, "karaoke-active-line.png") });
});
