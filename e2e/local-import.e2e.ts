import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";
import { passFirstRun } from "./ui/harness";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;

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

function put(file: string, bytes: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;
let music: string;

beforeAll(async () => {
  isolation = isolate("nuvo-local-e2e");
  music = path.join(isolation.work, "music");
  for (let album = 1; album <= 3; album++) {
    for (let track = 1; track <= 4; track++) put(path.join(music, `Artist ${album}`, "Album", `0${track} - Song ${track}.wav`), silentWav(1));
  }
  put(path.join(music, "Artist 1", "Album", "cover.jpg"), "not decoded during a scan");
  put(path.join(music, "Artist 1", "Album", "notes.txt"), "liner notes");
  put(path.join(music, "Artist 2", "Album", "rip.log"), "log");
  put(path.join(music, "Artist 2", "Album", "song.wma"), "wma");
  put(path.join(music, "Mixed", "02 Vandal - Long Road.mp3"), "tags a reader cannot parse");
  fs.symlinkSync(path.join(music, "Artist 1"), path.join(music, "Mixed", "link"));

  app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--ozone-platform=x11", `--user-data-dir=${isolation.userData}`, "--mute-audio", "--lang=en-US"],
    cwd: ROOT,
    env: { ...isolation.env, LANG: "en_US.UTF-8", LANGUAGE: "en_US", LC_ALL: "en_US.UTF-8" },
  });
  main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.nuvoShell));
  await main.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await main.reload();
  await main.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
  await passFirstRun(main);
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

describe("local import e2e", () => {
  it("a generated library is read once, counted the same everywhere and its skipped files are named", async () => {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, music);
    const added = await main.evaluate(() => window.nuvoShell!.addMusicFolder());
    expect(added).toMatchObject({ root: { path: music } });
    await expect
      .poll(() => main.evaluate(() => fetch("nuvo-core://local/v1/local/status").then((r) => r.json())), { timeout: 30_000 })
      .toMatchObject({ scanning: false, found: 13, read: 13, skipped: { jpg: 1, log: 1, txt: 1, wma: 1 }, skippedLinks: 1 });

    await main.evaluate(() => (location.hash = "#/library?tab=local"));
    await main.getByText("13 files").waitFor();
    await main.getByText("Skipped 4 files Nuvo doesn't play: .jpg 1, .log 1, .txt 1, 1 link").waitFor();
    const row = main.locator("[data-unavailable]");
    expect(await row.count()).toBe(0);
    await main.getByText("Long Road").waitFor();
    await main.getByText("Vandal", { exact: true }).waitFor();
  });
});
