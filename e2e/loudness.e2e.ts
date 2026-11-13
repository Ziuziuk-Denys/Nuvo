import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;

const SONG = { id: "fixture-quiet", title: "Quiet Room", artists: "Nova", coverUrl: "", durationMs: 20_000 };

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;

function toneWav(seconds: number, amplitude: number): Buffer {
  const rate = 48_000;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amplitude), i * 2);
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
  isolation = isolate("nuvo-loudness-e2e");
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

it("a cached song that plays gets its loudness measured", async () => {
  const wav = toneWav(20, 1500).toString("base64");
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
  const measured = () =>
    main.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem("nuvo_sound_v1") ?? "{}") as { state?: { loudness?: Record<string, { db: number }> } };
      return saved.state?.loudness?.[id]?.db ?? null;
    }, SONG.id);
  await expect.poll(measured, { timeout: 30_000, interval: 500 }).not.toBeNull();
  expect(await measured()).toBeGreaterThan(3);
});
