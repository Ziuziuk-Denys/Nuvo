import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, type NuvoSession } from "./harness";

/** Music folders end to end: add a generated folder, play a file, find it in search, save a cached streamed track as a file. */
const SHOTS = process.env.NUVO_LOCAL_SHOTS ?? path.join(os.homedir(), ".cache", "local-shots");
const LIGHT = { preset: "nuvo", mode: "light" } as const;
const STREAMED = "e2eSaveTst1";

let session: NuvoSession | null = null;
let music = "";
let saved = "";
let streamedMp3 = "";
const coverAnswers: { url: string; status: number }[] = [];

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

/** Two FLAC files and an MP3 with tags, an ALAC file the player cannot decode, and folder art; beside them one file with art of its own and one with none. */
function makeMusicFolder(dir: string): void {
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x2E9E6B:s=300x300:d=1", "-frames:v", "1", path.join(dir, "cover.jpg")]);
  const tone = (seconds: number, hz: number) => ["-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`];
  const tags = (title: string, track: number) => [
    "-metadata",
    `title=${title}`,
    "-metadata",
    "artist=Field Recorder",
    "-metadata",
    "album=Quiet Rooms",
    "-metadata",
    `track=${track}`,
  ];
  ffmpeg([...tone(8, 330), ...tags("Morning Field", 1), "-c:a", "flac", path.join(dir, "01 Morning Field.flac")]);
  ffmpeg([...tone(8, 440), ...tags("Evening Field", 2), "-c:a", "flac", path.join(dir, "02 Evening Field.flac")]);
  ffmpeg([...tone(8, 550), ...tags("Harbor Lights", 3), "-c:a", "libmp3lame", "-b:a", "192k", path.join(dir, "03 Harbor Lights.mp3")]);
  ffmpeg([...tone(8, 660), ...tags("Apple Orchard", 4), "-c:a", "alac", path.join(dir, "04 Apple Orchard.m4a")]);
  const sealed = path.join(dir, "Sealed");
  const bare = path.join(dir, "Bare");
  fs.mkdirSync(sealed);
  fs.mkdirSync(bare);
  const picture = [
    "-f",
    "lavfi",
    "-i",
    "color=c=0xE0402A:s=300x300:d=1",
    "-frames:v",
    "1",
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:v",
    "mjpeg",
    "-disposition:v",
    "attached_pic",
  ];
  ffmpeg([...tone(8, 770), ...picture, ...tags("Sealed Art", 5), "-c:a", "libmp3lame", path.join(sealed, "05 Sealed Art.mp3")]);
  ffmpeg([...tone(8, 880), ...tags("Bare Wire", 6), "-c:a", "libmp3lame", path.join(bare, "06 Bare Wire.mp3")]);
}

/** Main's folder dialog answers with this folder from now on; the renderer still never sends a path. */
async function pickFolder(live: NuvoSession, folder: string): Promise<void> {
  await live.app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [value] })) as typeof dialog.showOpenDialog;
  }, folder);
}

async function shot(live: NuvoSession, name: string, width: number, height: number): Promise<void> {
  await live.setSize({ width, height });
  await live.page.emulateMedia({ reducedMotion: "reduce" });
  await live.page.waitForTimeout(800);
  await live.page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`) });
}

async function openLocalTab(live: NuvoSession): Promise<void> {
  await live.go("#/library?tab=local");
  await live.page.reload();
  await live.page.locator("h1").first().waitFor({ timeout: 15_000 });
  await live.page.waitForTimeout(600);
}

beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  music = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-local-music-"));
  saved = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-local-saved-"));
  makeMusicFolder(music);
  streamedMp3 = path.join(saved, "..", `${path.basename(saved)}-src.mp3`);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=500:duration=5", "-c:a", "libmp3lame", "-b:a", "128k", streamedMp3]);
  session = await launchNuvo({ profile: "fresh" });
  session.page.on("response", (response) => {
    if (response.url().endsWith("/cover")) coverAnswers.push({ url: response.url(), status: response.status() });
  });
  await passFirstRun(session.page);
  await session.setLook(LIGHT);
});

afterAll(async () => {
  await session?.close();
  for (const target of [music, saved, streamedMp3]) if (target) fs.rmSync(target, { recursive: true, force: true });
});

describe("local files", () => {
  it("the tab invites adding a folder, then lists the files with the unsupported one dimmed", async () => {
    const live = session!;
    await openLocalTab(live);
    await expect.poll(() => live.page.getByText("Play your own files").count()).toBe(1);
    await shot(live, "local-empty-en", 1200, 780);

    await pickFolder(live, music);
    await live.page.getByRole("button", { name: "Add a music folder" }).click();
    await expect.poll(() => live.page.locator("[data-track-row]").count(), { timeout: 30_000 }).toBe(6);
    await expect.poll(() => live.page.getByText(/Watching 1 folder/).count(), { timeout: 15_000 }).toBe(1);
    expect(await live.page.getByText(path.basename(music)).count()).toBeGreaterThan(0);
    await live.page.locator("[data-track-row]").first().hover();
    await shot(live, "local-files-en", 1200, 780);

    // a local file takes a dislike like any song; with nothing playing the Undo comes as a toast
    expect(await live.page.locator("[data-track-row] [data-dislike]").count()).toBe(6);
    await live.page.locator("[data-track-row] [data-dislike]").first().click();
    const undo = live.page.locator("[data-toast]").getByRole("button", { name: "Undo" });
    await undo.waitFor({ timeout: 5_000 });
    await shot(live, "local-dislike-toast-en", 1200, 780);
    await undo.click();
    await undo.waitFor({ state: "detached" });
  });

  it("shows embedded and folder art, and a file without art asks for nothing", async () => {
    const live = session!;
    const drawn = (title: string) =>
      live.page.locator("[data-track-row]", { hasText: title }).evaluate((row) => {
        const image = row.querySelector("img");
        return image ? image.naturalWidth : -1;
      });
    await expect.poll(() => drawn("Sealed Art"), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => drawn("Morning Field"), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await drawn("Bare Wire")).toBe(-1);
    expect(coverAnswers.length).toBeGreaterThan(0);
    expect(coverAnswers.filter((answer) => answer.status !== 200)).toEqual([]);
  });

  it("plays a local file from the daemon", async () => {
    const live = session!;
    await live.page.locator("[data-track-row]", { hasText: "Morning Field" }).click();
    await expect
      .poll(() => live.page.evaluate(() => [navigator.mediaSession.metadata?.title ?? "", navigator.mediaSession.playbackState]), { timeout: 20_000 })
      .toEqual(["Morning Field", "playing"]);
    // Chromium refuses nuvo-core: artwork, so the cover reaches the system controls as data
    await expect
      .poll(() => live.page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.src.slice(0, 11) ?? ""), { timeout: 10_000 })
      .toBe("data:image/");
    await live.page.waitForTimeout(1500);
    await shot(live, "local-playing-en", 1200, 780);
  });

  it("finds a local file in search, first among songs", async () => {
    const live = session!;
    await live.go("#/search");
    const field = live.page.locator("input").first();
    await field.fill("Evening");
    await expect.poll(() => live.page.getByText("Evening Field").count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await live.page.waitForTimeout(1500);
    expect(await live.page.getByRole("region", { name: "Songs" }).locator("[data-dislike]").count()).toBeGreaterThan(0);
    await shot(live, "local-search-en", 1200, 780);
  });

  it("saves a cached streamed track as a file in the folder main picked", async () => {
    const live = session!;
    const audio = fs.readFileSync(streamedMp3).toString("base64");
    const status = await live.core(`
      const track = { id: "${STREAMED}", title: "Signal Garden", artists: [{ id: "", name: "Paper Satellites" }], durationMs: 5000 };
      await fetch(base + "/v1/me/library/tracks/${STREAMED}", { method: "PUT", headers: json, body: JSON.stringify({ track }) });
      const bytes = Uint8Array.from(atob("${audio}"), (c) => c.charCodeAt(0));
      const res = await fetch(base + "/v1/cache/audio/${STREAMED}", { method: "PUT", headers: { "Content-Type": "audio/mpeg", "X-Nuvo-Codec": "mp3", "x-nuvo-bitrate": "128" }, body: bytes });
      return res.status;
    `);
    expect([200, 201, 204]).toContain(status);

    await live.go("#/library/playlist?id=likes");
    await live.page.reload();
    const row = live.page.locator("[data-track-row]", { hasText: "Signal Garden" });
    await row.waitFor({ timeout: 15_000 });
    await pickFolder(live, saved);
    await row.click({ button: "right" });
    await live.page.getByRole("menuitem", { name: "Save as file" }).click();
    await expect
      .poll(() => fs.readdirSync(saved).filter((name) => !name.startsWith(".")), { timeout: 30_000 })
      .toEqual([expect.stringMatching(/Signal Garden.*\.mp3$/)]);
  });

  it("shows the same screens in Russian at 1100", async () => {
    const live = session!;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await openLocalTab(live);
    await expect.poll(() => live.page.getByText("Добавить папку с музыкой").count()).toBeGreaterThan(0);
    await shot(live, "local-files-ru", 1100, 705);
    await live.page.locator("[data-track-row]", { hasText: "Harbor Lights" }).click({ button: "right" });
    await expect.poll(() => live.page.getByRole("menuitem", { name: "Показать в папке" }).count()).toBe(1);
    await shot(live, "local-menu-ru", 1100, 705);
    await live.page.keyboard.press("Escape");
    await live.go("#/search");
    await live.page.locator("input").first().fill("Harbor");
    await expect.poll(() => live.page.getByText("Harbor Lights").count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await live.page.waitForTimeout(1500);
    await shot(live, "local-search-ru", 1100, 705);
  });
});
