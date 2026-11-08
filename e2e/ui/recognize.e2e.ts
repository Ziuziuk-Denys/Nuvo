import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run, searchResponse, shelf, songRow, thumb } from "../../src/youtube/test/shapes";
import { launchNuvo, passFirstRun, type Look, type NuvoSession } from "./harness";
import { fixtureCover, PLAYER_SESSION_KEY } from "./seed";

/*
  Runs against a `pnpm build`. The daemon is the real one: a real audio file goes through its ffmpeg and fingerprint,
  only the answer of the recognition service and the catalog are local. ffmpeg's capture devices are stood in for
  by a wrapper, so the microphone and system paths run on any machine.
  RECOGNIZE_LIVE_FILE=<a real song> instead sends that file to the real service and the real catalog.
*/
const SHOTS = process.env.RECOGNIZE_SHOTS ?? path.join(os.homedir(), ".cache", "recognize-shots");
const LIVE_FILE = process.env.RECOGNIZE_LIVE_FILE;
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };
const SIZE = { width: 1200, height: 780 };

const SONG = {
  matches: [{ id: "1", offset: 92.9 }],
  track: {
    key: "53982678",
    title: "Glass Harbour",
    subtitle: "Velvet Hour",
    genres: { primary: "Pop" },
    images: { coverarthq: fixtureCover(7) },
    sections: [
      {
        type: "SONG",
        metadata: [
          { title: "Album", text: "Northern Lights" },
          { title: "Released", text: "2021" },
        ],
      },
    ],
  },
};

let session: NuvoSession | null = null;
let work = "";
let shazam: http.Server | null = null;
let answer: "found" | "none" = "found";
/** How long the service holds its answer, so the listening state can be looked at. */
let holdMs = 0;
const savedEnv = { PATH: process.env.PATH, NUVO_CORE_SHAZAM_URL: process.env.NUVO_CORE_SHAZAM_URL };

async function startShazam(): Promise<string> {
  shazam = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer === "found" ? SONG : { matches: [] }));
      }, holdMs);
    });
  });
  await new Promise<void>((resolve) => shazam?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(shazam.address() as AddressInfo).port}`;
}

/** A 20 s stereo clip with a moving signal, and an ffmpeg that reads it in place of the capture devices. */
function prepareAudio(): string {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-recognize-"));
  const clip = path.join(work, "Morning walk.wav");
  const wave = (hz: number) => `sin(${hz}*2*PI*t)*(0.5+0.5*sin(0.2*2*PI*t))`;
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `aevalsrc=${wave(1000)}|${wave(2500)}:s=16000:d=20`, clip]);
  const real = execFileSync("sh", ["-c", "command -v ffmpeg"]).toString().trim();
  const shim = path.join(work, "bin");
  fs.mkdirSync(shim);
  fs.writeFileSync(
    path.join(shim, "ffmpeg"),
    `#!/bin/sh
case "$*" in
*@DEFAULT_SOURCE@*) if [ -e "${work}/no-microphone" ]; then echo "Connection refused" >&2; exit 1; fi ;;
*@DEFAULT_MONITOR@*) ;;
*) exec "${real}" "$@" ;;
esac
exec "${real}" -nostdin -hide_banner -loglevel error -t 12 -i "${clip}" -vn -ac 2 -ar 16000 -f s16le -
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${shim}:${process.env.PATH}`;
  return clip;
}

/** The catalog answers every search with the recognized song, every other host stays closed. */
async function installCatalog(page: Page): Promise<void> {
  const search = searchResponse(
    shelf(
      songRow({
        id: "vidGLASS0001",
        title: "Glass Harbour",
        artists: [["Velvet Hour", "UCvelvet0000000000000001"]],
        duration: "3:42",
        thumbnail: thumb(fixtureCover(7), 120, 120),
      }),
    ),
  );
  await page.addInitScript((body) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate_204")) {
        if (!navigator.onLine) throw new TypeError("Failed to fetch");
        return new Response(null, { status: 204 });
      }
      if (url.includes("/youtubei/v1/search")) return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (/youtube|googlevideo/.test(url)) return new Response("", { status: 404 });
      return real(input, init);
    };
  }, search);
}

/**
 * The daemon's link job needs yt-dlp and the real sites, so its stream is stood in for here; the file, microphone
 * and system jobs above stay real. The link names the answer: "found", "private" or anything else for no match.
 */
async function fakeLinkJobs(page: Page): Promise<void> {
  await page.addInitScript((cover) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/v1/recognize") || typeof init?.body !== "string" || !init.body.includes('"url"')) return real(input, init);
      const link = String(JSON.parse(init.body).url);
      const song = {
        title: "Glass Harbour",
        artist: "Velvet Hour",
        album: "Northern Lights",
        released: "2021",
        genre: "Pop",
        coverUrl: cover,
        offsetMs: 83_400,
        appleMusicUrl: "https://music.apple.com/us/album/glass-harbour/1?i=2",
        via: "mix",
        input: { kind: "link", label: "Morning walk" },
      };
      const last = link.includes("found")
        ? { type: "result", id: "link1", track: song }
        : link.includes("private")
          ? { type: "error", code: "unavailable" }
          : { type: "notFound", more: false };
      const events: [number, object][] = [
        [0, { type: "stage", name: "resolving" }],
        [300, { type: "stage", name: "fetching", detail: "Morning walk" }],
        [
          1500,
          {
            type: "stage",
            name: "listening",
            attempt: 1,
            of: 2,
            via: "mix",
            envelope: Array.from({ length: 48 }, (_, i) => 0.3 + 0.6 * Math.abs(Math.sin(i / 3))),
          },
        ],
        [1500, last],
      ];
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const [wait, event] of events) {
            await new Promise((done) => setTimeout(done, wait));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  }, fixtureCover(7));
}

/** The look stays as it is: changing it reloads the window, which would end the job on screen. */
async function shot(live: NuvoSession, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await live.page.evaluate(() => document.fonts.ready.then(() => undefined));
  await live.page.waitForTimeout(700);
  await live.page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function useLook(live: NuvoSession, look: Look): Promise<void> {
  await live.setLook(look);
  await live.setSize(SIZE);
  await live.page.emulateMedia({ reducedMotion: "reduce" });
}

const panel = (page: Page) => page.locator("[data-recognize]");
const panelIs = (page: Page, phase: string) => page.locator(`[data-recognize="${phase}"]`).waitFor({ timeout: 30_000 });
const pick = (page: Page, file: string) => page.locator("[data-recognize-file]").setInputFiles(file);

beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

afterAll(async () => {
  await session?.close();
  shazam?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
  process.env.PATH = savedEnv.PATH;
  if (savedEnv.NUVO_CORE_SHAZAM_URL === undefined) delete process.env.NUVO_CORE_SHAZAM_URL;
  else process.env.NUVO_CORE_SHAZAM_URL = savedEnv.NUVO_CORE_SHAZAM_URL;
});

describe.runIf(LIVE_FILE)("recognize, live", () => {
  it("names a real song through the real service and plays the catalog's copy", async () => {
    const live = await launchNuvo({ profile: "fresh", locale: "en" });
    session = live;
    const page = live.page;
    await passFirstRun(page);
    await page.locator('[data-nav="recognize"]').click();
    for (const look of [LIGHT, DARK]) {
      await useLook(live, look);
      await pick(page, LIVE_FILE as string);
      await page.locator('[data-recognize="found"], [data-recognize="not_found"], [data-recognize="failed"]').waitFor({ timeout: 90_000 });
      console.log("LIVE RESULT:", (await panel(page).innerText()).replaceAll("\n", " | "));
      const card = page.locator("[data-recognize-result]");
      await card.locator("img[data-loaded]").waitFor({ timeout: 30_000 });
      const play = card.getByRole("button", { name: /^Play( from \d+:\d\d)?$/ });
      await expect.poll(() => play.isEnabled(), { timeout: 45_000 }).toBe(true);
      await shot(live, `live-result-${look.mode}`);
    }
    await page
      .locator("[data-recognize-result]")
      .getByRole("button", { name: /^Play( from \d+:\d\d)?$/ })
      .click();
    await page.locator("[data-island-title]").waitFor({ timeout: 30_000 });
    console.log("LIVE PLAYING:", await page.locator("[data-island-title]").innerText());
    await page.waitForTimeout(6_000);
    console.log("LIVE STATE:", await page.locator("[data-island]").innerText());
    await shot(live, "live-playing-dark");
    await session.close();
    session = null;
  }, 300_000);
});

describe.skipIf(LIVE_FILE)("recognize", () => {
  it("is one click from anywhere, and every state works on a real audio file", async () => {
    const clip = prepareAudio();
    process.env.NUVO_CORE_SHAZAM_URL = await startShazam();
    const live = await launchNuvo({ profile: "fresh", locale: "en" });
    session = live;
    const page = live.page;
    await installCatalog(page);
    await fakeLinkJobs(page);
    await page.reload();
    await passFirstRun(page);

    for (const look of [LIGHT, DARK]) {
      const name = (state: string) => `${state}-${look.mode}`;
      answer = "found";
      await useLook(live, look);

      // from the Library, one click
      await live.go("#/library");
      await page.locator('[data-nav="recognize"]').click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/recognize");
      await page.getByRole("heading", { name: "What’s playing?" }).waitFor();
      expect(await page.locator('[data-nav="recognize"]').getAttribute("aria-current")).toBe("page");
      await shot(live, name("01-idle"));

      // a real file through the bridge, the grant, ffmpeg and the fingerprint
      await pick(page, clip);
      const card = page.locator("[data-recognize-result]");
      await card.waitFor({ timeout: 30_000 });
      expect(await card.innerText()).toContain("Glass Harbour");
      expect(await card.innerText()).toContain("Northern Lights · 2021 · Pop");
      await card.getByRole("button", { name: /^(Like|Remove from liked songs)$/ }).waitFor({ timeout: 20_000 });
      await card.locator("img[data-loaded]").waitFor({ timeout: 10_000 });
      await shot(live, name("02-result"));

      // the row it left in the history
      const row = page.locator("[data-recognize-row]").first();
      await row.waitFor({ timeout: 10_000 });
      expect(await row.innerText()).toContain("Glass Harbour");

      // Like, Add to playlist and Play act on the catalog's copy
      await card.getByRole("button", { name: /^(Like|Remove from liked songs)$/ }).click();
      await card.getByRole("button", { name: "Add to playlist" }).click();
      await page.getByRole("dialog").waitFor();
      await shot(live, name("03-add-to-playlist"));
      await page.keyboard.press("Escape");
      await card.getByRole("button", { name: /^Play( from \d+:\d\d)?$/ }).click();
      await page.locator("[data-island-title]").waitFor({ timeout: 15_000 });
      expect(await page.locator("[data-island-title]").innerText()).toBe("Glass Harbour");
      await page.getByRole("button", { name: "Recognize another" }).click();
      await panelIs(page, "idle");

      // system audio, through the stand-in device
      holdMs = 3_000;
      await page.getByRole("button", { name: "This computer" }).click();
      await page.getByRole("heading", { name: "Listening…" }).waitFor({ timeout: 5_000 });
      await page.getByRole("heading", { name: "Looking it up" }).waitFor({ timeout: 10_000 });
      await page.getByText("Part 1 of 2").waitFor();
      // the real peaks: bars of many heights, nothing breathing any more
      const heights = await page
        .locator("[data-recognize] [aria-hidden] i")
        .evaluateAll((bars) => new Set(bars.map((bar) => (bar as HTMLElement).style.getPropertyValue("--peak"))).size);
      expect(heights).toBeGreaterThan(4);
      await shot(live, name("04-listening"));
      await card.waitFor({ timeout: 30_000 });
      holdMs = 0;
      await page.getByRole("button", { name: "Recognize another" }).click();

      // no match
      answer = "none";
      await page.getByRole("button", { name: "Microphone" }).click();
      await page.getByRole("heading", { name: "No match" }).waitFor({ timeout: 30_000 });
      await shot(live, name("05-no-match"));

      // no access to the microphone
      fs.writeFileSync(path.join(work, "no-microphone"), "");
      await page.getByRole("button", { name: "Microphone" }).click();
      await page.getByRole("heading", { name: "Nuvo can’t use the microphone" }).waitFor({ timeout: 15_000 });
      await shot(live, name("06-no-permission"));
      fs.rmSync(path.join(work, "no-microphone"));

      // Stop ends a job at once
      await pick(page, clip);
      await page.getByRole("button", { name: "Stop" }).click();
      await panelIs(page, "idle");

      // offline, with the history still there
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.getByRole("heading", { name: "You’re offline" }).waitFor({ timeout: 40_000 });
      expect(await page.getByRole("button", { name: "Microphone" }).isDisabled()).toBe(true);
      await shot(live, name("07-offline"));
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.getByRole("heading", { name: "What’s playing?" }).waitFor({ timeout: 40_000 });
    }

    // a link to a video or post: the form, its reading and listening states, the result, a gone post and no match
    await useLook(live, LIGHT);
    await page.getByRole("button", { name: "From a link" }).click();
    const linkField = page.getByRole("textbox", { name: "Video or post link" });
    await expect.poll(() => linkField.evaluate((node) => node === document.activeElement)).toBe(true);
    expect(await page.getByRole("button", { name: "Recognize", exact: true }).isDisabled()).toBe(true);
    await linkField.fill("https://www.instagram.com/reel/found/");
    await shot(live, "08-link-form-light");
    await page.getByRole("button", { name: "Recognize", exact: true }).click();
    await page.getByRole("heading", { name: "Reading the link" }).waitFor({ timeout: 5_000 });
    await page.getByText("Morning walk").waitFor({ timeout: 5_000 });
    await shot(live, "09-link-reading-light");
    await page.getByText("Part 1 of 2").waitFor({ timeout: 5_000 });
    const linkCard = page.locator("[data-recognize-result]");
    await linkCard.waitFor({ timeout: 15_000 });
    expect(await linkCard.innerText()).toContain("Glass Harbour");
    await shot(live, "10-link-result-light");
    await page.getByRole("button", { name: "Recognize another" }).click();
    await page.getByRole("button", { name: "From a link" }).click();
    await linkField.fill("https://vk.com/video-1_private");
    await linkField.press("Enter");
    await page.getByText("This video or post is gone or private.").waitFor({ timeout: 15_000 });
    await shot(live, "11-link-gone-light");
    await page.getByRole("button", { name: "From a link" }).click();
    await linkField.fill("https://www.tiktok.com/@a/video/7000000000000000001");
    await linkField.press("Enter");
    await page.getByRole("heading", { name: "No match" }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "From a link" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Microphone" }).waitFor();

    // Russian at the narrow window: nothing runs out of the panel
    await page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await page.reload();
    await live.setSize({ width: 1100, height: 705 });
    await page.getByRole("heading", { name: "Что это за песня?" }).waitFor({ timeout: 30_000 });
    await shot(live, "01-idle-ru-1100");
    // the four inputs stay on one row in the longer language too
    const rows = await page
      .locator('[data-tour="recognize-sources"] button')
      .evaluateAll((buttons) => new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size);
    expect(rows).toBe(1);
    await page.getByRole("button", { name: "По ссылке" }).click();
    await page.getByRole("textbox", { name: "Ссылка на видео или пост" }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await shot(live, "08-link-form-ru-1100");

    // the result's widest set of actions stays inside its card in Russian, at 1100 and wide, light and dark
    for (const look of [LIGHT, DARK]) {
      if (look === DARK) {
        await live.setLook(DARK);
        await page.getByRole("button", { name: "По ссылке" }).click();
      }
      const ruField = page.getByRole("textbox", { name: "Ссылка на видео или пост" });
      await ruField.fill("https://www.instagram.com/reel/found/");
      await ruField.press("Enter");
      const ruCard = page.locator("[data-recognize-result]");
      await ruCard.locator("[data-recognize-like]").waitFor({ timeout: 20_000 });
      for (const size of [
        { width: 1100, height: 705 },
        { width: 1600, height: 960 },
      ]) {
        await live.setSize(size);
        const spill = await ruCard.evaluate((card) => {
          const edge = card.getBoundingClientRect().right;
          return Math.max(...[...card.querySelectorAll("button")].map((button) => button.getBoundingClientRect().right - edge));
        });
        expect(spill, `Russian result actions fit at ${size.width}`).toBeLessThanOrEqual(0);
        await shot(live, `10-link-result-ru-${look.mode}-${size.width}`);
      }
      await page.getByRole("button", { name: "Узнать другую" }).click();
      await live.setSize({ width: 1100, height: 705 });
    }
    await session.close();
    session = null;
  }, 300_000);
});

describe.skipIf(LIVE_FILE)("dislike", () => {
  it.each([LIGHT, DARK])(
    "sits on every song row and in the bar, applies at once, undoes, and skips the playing song ($mode)",
    async (look) => {
      const name = (state: string) => `${state}-${look.mode}`;
      const live = await launchNuvo({ profile: "seeded" });
      session = live;
      const page = live.page;
      await page.evaluate((key) => {
        const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(key, JSON.stringify({ ...stored, index: 0 }));
      }, PLAYER_SESSION_KEY);
      await page.reload();
      await useLook(live, look);
      await page.locator("[data-island]").waitFor({ timeout: 30_000 });
      const hidden = () => live.core(`return (await (await fetch(base + "/v1/recs/suppressions")).json()).items.length;`);

      // a playlist: every row has one, by keyboard too
      await live.go(`#/library/playlist?id=${live.seed!.smallPlaylistId}`);
      const rows = page.locator("[data-track-row]");
      await rows.first().waitFor({ timeout: 15_000 });
      expect(await rows.count()).toBeGreaterThan(5);
      expect(await page.locator("[data-track-row] [data-dislike]").count()).toBe(await rows.count());
      await expect.poll(() => rows.first().locator("[data-dislike]").isVisible()).toBe(true);
      await rows.first().focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-dislike"))).toBe(true);
      await shot(live, name("10-playlist-rows"));

      // a press on a row: stored, the notice with Undo, and Undo takes it back
      const before = (await hidden()) as number;
      await rows.nth(3).locator("[data-dislike]").click();
      await expect.poll(hidden).toBe(before + 1);
      const undo = page.locator("[data-island]").getByRole("button", { name: "Undo" });
      await undo.waitFor({ timeout: 5_000 });
      await shot(live, name("11-undo-notice"));
      await undo.click();
      await expect.poll(hidden).toBe(before);

      // the bar: a dislike skips the playing song and is stored
      const title = page.locator("[data-island-title]");
      const first = await title.innerText();
      await page.locator("[data-island] [data-dislike]").click();
      await expect.poll(() => title.innerText()).not.toBe(first);
      await expect.poll(hidden).toBe(before + 1);
      await shot(live, name("12-bar"));

      // the queue: the playing row keeps its button without a hover
      await page.locator('[data-tour="queue"]').click();
      const playing = page.locator('aside [aria-current="true"]').first();
      await playing.waitFor();
      await page.mouse.move(300, 300);
      expect(await playing.locator("[data-dislike]").isVisible()).toBe(true);
      await shot(live, name("13-queue"));
      await page.keyboard.press("Escape");

      // karaoke: the same press, and the Undo comes as a toast because the bar is covered
      await live.go("#/player");
      await page.locator("section").getByRole("button", { name: "Dislike" }).click({ timeout: 15_000 });
      await page.locator("[data-toast]").getByRole("button", { name: "Undo" }).waitFor({ timeout: 5_000 });
      await shot(live, name("14-karaoke"));
      await session.close();
      session = null;
    },
    300_000,
  );
});
