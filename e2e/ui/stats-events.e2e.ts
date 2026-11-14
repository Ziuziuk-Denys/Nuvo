import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "../isolation";
import { passFirstRun } from "./harness";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CACHED = ["e2eStatsAa1", "e2eStatsBb2", "e2eStatsCc3"];

interface Event {
  track: { id: string; title: string };
  playedDurationMs: number;
  completed: boolean;
  skipped: boolean;
  context?: { type: string; id?: string };
}

let profile: Isolation;
let app: ElectronApplication | null = null;
let page: Page;
let music = "";

async function launch(): Promise<void> {
  app = await electron.launch({ args: [ROOT, `--user-data-dir=${profile.userData}`, "--mute-audio"], cwd: ROOT, env: profile.env });
  const deadline = Date.now() + 30_000;
  let found: Page | undefined;
  while (!found && Date.now() < deadline) {
    found = app.windows().find((win) => !win.url().includes("#/notch"));
    if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!found) throw new Error("main window did not appear");
  page = found;
  await page.waitForLoadState("domcontentloaded");
}

async function gone(running: ElectronApplication): Promise<void> {
  const child = running.process();
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

const core = (script: string): Promise<unknown> =>
  page.evaluate(`(async () => { const base = "nuvo-core://local"; const json = { "Content-Type": "application/json" }; ${script} })()`);

async function events(): Promise<Event[]> {
  const body = (await core(`return (await fetch(base + "/v1/me/history?limit=200")).json();`)) as { items: Event[] };
  return body.items;
}

const eventOf = async (title: string): Promise<Event | undefined> => (await events()).find((event) => event.track.title === title);

async function open(hash: string): Promise<void> {
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.waitForTimeout(500);
}

function tone(file: string, seconds: number, hz: number, title: string, artist: string): void {
  const tags = ["-metadata", `title=${title}`, "-metadata", `artist=${artist}`, "-metadata", "album=Stat Rooms"];
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`, ...tags, file]);
}

async function seedCached(seconds: number): Promise<void> {
  const file = path.join(music, "..", `${path.basename(music)}-cached.mp3`);
  tone(file, seconds, 500, "", "");
  const audio = fs.readFileSync(file).toString("base64");
  fs.rmSync(file);
  for (const [index, id] of CACHED.entries()) {
    const status = await core(`
      const track = { id: "${id}", title: "Cached ${index + 1}", artists: [{ id: "", name: "Stat Band" }], durationMs: ${seconds * 1000} };
      await fetch(base + "/v1/me/library/tracks/${id}", { method: "PUT", headers: json, body: JSON.stringify({ track }) });
      const bytes = Uint8Array.from(atob("${audio}"), (c) => c.charCodeAt(0));
      return (await fetch(base + "/v1/cache/audio/${id}", { method: "PUT", headers: { "Content-Type": "audio/mpeg", "X-Nuvo-Codec": "mp3", "x-nuvo-bitrate": "128" }, body: bytes })).status;
    `);
    expect([200, 201, 204]).toContain(status);
  }
}

const playing = (title: string) =>
  expect
    .poll(() => page.evaluate(() => [navigator.mediaSession.metadata?.title ?? "", navigator.mediaSession.playbackState]), { timeout: 20_000 })
    .toEqual([title, "playing"]);

async function playLiked(title: string): Promise<void> {
  await open("#/library/playlist?id=likes");
  const row = page.locator("[data-track-row]", { hasText: title });
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await playing(title);
}

async function playLocal(title: string): Promise<void> {
  await open("#/library?tab=local");
  const row = page.locator("[data-track-row]", { hasText: title });
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await playing(title);
}

beforeAll(async () => {
  music = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-stats-music-"));
  tone(path.join(music, "01 Field A.mp3"), 7, 330, "Field A", "Field Recorder");
  tone(path.join(music, "02 Field B.mp3"), 7, 440, "Field B", "Field Recorder");
  tone(path.join(music, "03 Field C.mp3"), 40, 550, "Field C", "Field Recorder");
  profile = isolate("nuvo-stats");
  await launch();
  await passFirstRun(page);
  await seedCached(6);
  await app!.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [value] })) as typeof dialog.showOpenDialog;
  }, music);
});

afterAll(async () => {
  if (app) {
    const pid = app.process().pid;
    await app.close().catch(() => undefined);
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  profile?.dispose();
  fs.rmSync(music, { recursive: true, force: true });
});

describe("play events", () => {
  it("starts from a scanned folder", async () => {
    await open("#/library?tab=local");
    await page.reload();
    await page.getByRole("button", { name: "Add a music folder" }).click();
    await expect.poll(() => page.locator("[data-track-row]").count(), { timeout: 30_000 }).toBe(3);
  });

  it("records a local file played to its end and the next one gaplessly", async () => {
    await playLocal("Field A");
    await playing("Field B");
    await expect.poll(() => eventOf("Field A"), { timeout: 20_000 }).toMatchObject({ completed: true, context: { type: "local" } });
    const event = (await eventOf("Field A"))!;
    expect(event.playedDurationMs).toBeGreaterThan(5000);
    expect(event.playedDurationMs).toBeLessThan(9000);
  });

  it("records a skip with the real time played, not the track length", async () => {
    await playLiked("Cached 1");
    await page.waitForTimeout(3500);
    await playLocal("Field C");
    await expect
      .poll(() => eventOf("Cached 1"), { timeout: 15_000 })
      .toMatchObject({ completed: false, skipped: true, context: { type: "playlist", id: "likes" } });
    const event = (await eventOf("Cached 1"))!;
    expect(event.playedDurationMs).toBeGreaterThan(3000);
    expect(event.playedDurationMs).toBeLessThan(6000);
  });

  it("records radio plays under the radio context", async () => {
    await open("#/library?tab=local");
    await page.locator("[data-track-row]", { hasText: "Field A" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Start radio" }).click();
    await playing("Field A");
    await page.waitForTimeout(3500);
    await playLocal("Field C");
    await expect.poll(async () => (await events()).find((e) => e.track.title === "Field A" && e.context?.type === "radio"), { timeout: 15_000 }).toBeTruthy();
  });

  it("records a search hit under the search context", async () => {
    await open("#/search");
    await page.getByPlaceholder("Songs, albums, artists").fill("Field B");
    await page
      .getByRole("button", { name: /Field B/ })
      .first()
      .click({ timeout: 15_000 });
    await playing("Field B");
    await page.waitForTimeout(3500);
    await playLocal("Field C");
    await expect.poll(async () => (await events()).find((e) => e.track.title === "Field B" && e.context?.type === "search"), { timeout: 15_000 }).toBeTruthy();
  });

  it("records through a crossfade", async () => {
    await page.evaluate(() => {
      const raw = localStorage.getItem("nuvo.player.prefs.v3") ?? "{}";
      localStorage.setItem("nuvo.player.prefs.v3", JSON.stringify({ ...JSON.parse(raw), crossfadeSeconds: 2 }));
    });
    await page.reload();
    await playLiked("Cached 3");
    await playing("Cached 2");
    await expect.poll(() => eventOf("Cached 3"), { timeout: 20_000 }).toMatchObject({ completed: true, context: { type: "playlist", id: "likes" } });
    await page.evaluate(() => {
      const raw = localStorage.getItem("nuvo.player.prefs.v3") ?? "{}";
      localStorage.setItem("nuvo.player.prefs.v3", JSON.stringify({ ...JSON.parse(raw), crossfadeSeconds: 0 }));
    });
  });

  it("records offline plays of cached songs", async () => {
    const before = (await events()).filter((e) => e.track.title === "Cached 2").length;
    await page.evaluate(() => localStorage.setItem("nuvo.offlineMode", "1"));
    await page.reload();
    await playLiked("Cached 2");
    await page.waitForTimeout(3500);
    await playLocal("Field C");
    await expect.poll(async () => (await events()).filter((e) => e.track.title === "Cached 2").length, { timeout: 15_000 }).toBeGreaterThan(before);
    await page.evaluate(() => localStorage.removeItem("nuvo.offlineMode"));
  });

  it("records the play the app was quit in the middle of", async () => {
    await playLocal("Field C");
    await page.waitForTimeout(4500);
    const before = (await events()).length;
    const running = app!;
    await running.evaluate(({ app: electronApp }) => electronApp.quit());
    await gone(running);
    await launch();
    await page.locator("[data-nav=home]").waitFor({ timeout: 30_000 });
    await expect.poll(async () => (await events()).length, { timeout: 15_000 }).toBeGreaterThan(before);
    const event = (await events())[0];
    expect(event.track.title).toBe("Field C");
    expect(event.playedDurationMs).toBeGreaterThan(3000);
  });

  it("keeps the play of an app that was killed", async () => {
    await playLocal("Field C");
    await page.waitForTimeout(6000);
    const before = (await events()).length;
    const running = app!;
    running.process().kill("SIGKILL");
    await gone(running);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await launch();
    await page.locator("[data-nav=home]").waitFor({ timeout: 30_000 });
    await expect.poll(async () => (await events()).length, { timeout: 15_000 }).toBeGreaterThan(before);
    expect((await events())[0].playedDurationMs).toBeGreaterThan(3000);
  });

  it("kept what started each play and where it came from", async () => {
    const stats = (await core(`return (await fetch(base + "/v1/stats/overview")).json();`)) as { sources: { kind: string }[]; origins: { kind: string }[] };
    expect(stats.sources.map((share) => share.kind).sort()).toEqual(expect.arrayContaining(["local", "playlist", "radio", "search"]));
    expect(stats.origins.map((share) => share.kind).sort()).toEqual(["cache", "local"]);
  });

  it.skipIf(!process.env.NUVO_STATS_STREAM)("records a real stream from the network as a stream", { timeout: 120_000 }, async () => {
    await open("#/search");
    await page.getByPlaceholder("Songs, albums, artists").fill("Bohemian Rhapsody Queen");
    await page
      .getByRole("button", { name: /Bohemian Rhapsody/ })
      .first()
      .click({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState), { timeout: 45_000 }).toBe("playing");
    await page.waitForTimeout(8000);
    await playLocal("Field C");
    await expect
      .poll(async () => (await events()).find((e) => e.context?.type === "search" && e.track.title.includes("Bohemian"))?.playedDurationMs ?? 0, {
        timeout: 15_000,
      })
      .toBeGreaterThan(5000);
    const stats = (await core(`return (await fetch(base + "/v1/stats/overview")).json();`)) as { origins: { kind: string; listenedMs: number }[] };
    expect(stats.origins.find((origin) => origin.kind === "stream")?.listenedMs).toBeGreaterThan(5000);
  });
});
