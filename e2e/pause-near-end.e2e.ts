import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const SONGS = ["fixture-first", "fixture-second"].map((id, i) => ({ id, title: `Song ${i + 1}`, artists: "Nova", coverUrl: "", durationMs: 20_000 }));

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;

function silentWav(seconds: number): Buffer {
  const data = Buffer.alloc(8000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const player = (script: string) => main.evaluate(`window.__nuvoPlayer.engine.${script}`);
const view = () => main.evaluate(`(({ status, current }) => ({ status, id: current?.track.id }))(window.__nuvoPlayer.engine.getView())`);

beforeAll(async () => {
  isolation = isolate("nuvo-pause-end-e2e");
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
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer), undefined, { timeout: 60_000 });
  await main.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
  const wav = silentWav(20).toString("base64");
  for (const song of SONGS) {
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
      { id: song.id, wav },
    );
    expect(status).toBeLessThan(300);
  }
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

it("a pause near the end of a track stays paused past its end, and play goes on to the next track", async () => {
  await main.evaluate(
    (songs) => (window as unknown as { __nuvoPlayer: { engine: { playList(tracks: unknown[]): void } } }).__nuvoPlayer.engine.playList(songs),
    SONGS,
  );
  await expect.poll(view).toEqual({ status: "playing", id: SONGS[0].id });
  await player("seekTo(14000)");
  await main.waitForTimeout(2_000);
  await player("pause()");
  await expect.poll(view).toEqual({ status: "paused", id: SONGS[0].id });
  await main.waitForTimeout(8_000);
  expect(await view()).toEqual({ status: "paused", id: SONGS[0].id });
  await player("resume()");
  await expect.poll(view, { timeout: 10_000 }).toEqual({ status: "playing", id: SONGS[1].id });
}, 60_000);
