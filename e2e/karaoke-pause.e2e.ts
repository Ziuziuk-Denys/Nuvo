import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const SONG = { id: "fixture-hook", title: "Hook Song", artists: "Nova", coverUrl: "", durationMs: 60_000 };
const VERSE = ["Walking down the road", "Counting all the lights", "Nobody on the phone", "Another empty night"];
const HOOK = ["Same old story", "Same old story", "Same old song", "Same old story"];
const LINES = [...VERSE, ...HOOK, ...VERSE.map((line) => `${line} again`), ...HOOK, ...HOOK];

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;
let provider: http.Server;

function lrc(): string {
  const stamp = (ms: number) => {
    const seconds = ms / 1000;
    return `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}]`;
  };
  return LINES.map((line, index) => `${stamp(1_000 + index * 2_500)}${line}`).join("\n");
}

function toneWav(seconds: number): Buffer {
  const rate = 16_000;
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

const player = (script: string) => main.evaluate(`window.__nuvoPlayer.engine.${script}`);

function sample() {
  return main.evaluate(() => {
    const view = document.querySelector("braccato-lyrics")!.parentElement!.getBoundingClientRect();
    const lines = [...document.querySelectorAll<HTMLElement>("braccato-lyrics .blyrics--line")];
    const lit = lines.findIndex((line) => line.hasAttribute("data-nuvo-now"));
    const rects = lines.map((line) => line.getBoundingClientRect());
    const top = lit >= 0 ? rects[lit].top - view.top : null;
    return { lit, top, pitch: lit >= 0 && rects[lit + 1] ? rects[lit + 1].top - rects[lit].top : 0 };
  });
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
      syncedLyrics: lrc(),
    };
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/api/get")) response.end(JSON.stringify(record));
    else if (request.url?.startsWith("/api/search")) response.end(JSON.stringify([record]));
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const { port } = provider.address() as { port: number };
  isolation = isolate("nuvo-pause-e2e");
  isolation.env.NUVO_CORE_LRCLIB_URL = `http://127.0.0.1:${port}`;
  isolation.env.NUVO_CORE_AMLL_URL = "";
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
  const wav = toneWav(60).toString("base64");
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
  await main.evaluate(
    (song) => (window as unknown as { __nuvoPlayer: { engine: { playList(tracks: unknown[]): void } } }).__nuvoPlayer.engine.playList([song]),
    SONG,
  );
  await main.evaluate(() => {
    location.hash = "#/player";
  });
  await main.locator("braccato-lyrics .blyrics--line").first().waitFor({ timeout: 30_000 });
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

it("pausing keeps the sung line where it is and resuming goes on from there", async () => {
  await player("seekTo(26000)");
  await main.waitForTimeout(3_000);
  const before = await sample();
  expect(before.lit).toBeGreaterThan(0);
  await player("pause()");
  const paused = [];
  for (let i = 0; i < 15; i++) {
    paused.push(await sample());
    await main.waitForTimeout(100);
  }
  for (const now of paused) {
    expect(now.lit).toBe(before.lit);
    expect(Math.abs(now.top! - before.top!)).toBeLessThanOrEqual(4);
  }
  await player("resume()");
  for (let i = 0; i < 20; i++) {
    const now = await sample();
    expect(now.lit).toBeGreaterThanOrEqual(before.lit);
    expect(Math.abs(now.top! - before.top!)).toBeLessThanOrEqual(before.pitch);
    await main.waitForTimeout(75);
  }
}, 60_000);
