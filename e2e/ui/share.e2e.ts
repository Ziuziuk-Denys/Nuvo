import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encodeShare, type ShareTrack } from "../../src/links/shareCodec";
import { launchNuvo, type Look, type NuvoSession } from "./harness";
import { trackSnapshot } from "./seed";

const SHOTS = path.join(os.homedir(), ".cache", "share-shots");
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };
const WIDE = { width: 1200, height: 780 };
const NARROW = { width: 1100, height: 705 };

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

/** Eleven characters from the YouTube id alphabet that never repeat, so deflate cannot shrink the link. */
function youtubeIds(count: number, seed: number): string[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let state = seed;
  return Array.from({ length: count }, () =>
    Array.from({ length: 11 }, () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return alphabet[(state >>> 16) % 64];
    }).join(""),
  );
}

const NAMES: [string, string][] = [
  ["Кино", "Группа крови"],
  ["Massive Attack", "Teardrop"],
  ["Земфира", "Хочешь?"],
  ["Burial", "Archangel"],
  ["Portishead", "Glory Box"],
  ["Сплин", "Выхода нет"],
  ["Daft Punk", "Digital Love"],
  ["Björk", "Jóga"],
];

/** A `full` link: every song carries its names, so the preview needs no lookup. */
async function fullLink(): Promise<string> {
  const tracks: ShareTrack[] = youtubeIds(40, 11).map((id, index) => {
    const [artist, title] = NAMES[index % NAMES.length];
    return { source: "youtube", id, artist, title: index < NAMES.length ? title : `${title} ${index}`, durationSec: 180 + index };
  });
  return `nuvo://share?id=${await encodeShare({ title: "Вечерний плейлист", tracks })}`;
}

/** A `lean` link: id-only songs, looked up on arrival; offline, the second one reads as gone. */
async function leanLink(): Promise<string> {
  const tracks: ShareTrack[] = NAMES.map(([artist, title], index) =>
    index === 1 ? { source: "youtube", id: youtubeIds(1, 99)[0], durationSec: 210 } : { source: "text", artist, title, durationSec: 200 + index },
  );
  return `nuvo://share?id=${await encodeShare({ title: "Road", tracks })}`;
}

async function shot(name: string): Promise<string> {
  const page = session!.page;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(900);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** A share link arriving while Nuvo runs: main hears a second launch with the link, as the OS sends it. */
async function arrive(link: string): Promise<void> {
  await session!.app.evaluate(({ app }, value) => {
    app.emit("second-instance", {}, [process.execPath, ".", value], process.cwd());
  }, link);
  await session!.page.getByRole("dialog").waitFor({ timeout: 15_000 });
}

async function closeDialog(): Promise<void> {
  await session!.page.keyboard.press("Escape");
  await session!.page.getByRole("dialog").waitFor({ state: "detached", timeout: 10_000 });
}

/** The open dialog: inside the window, nothing wider than its panel. */
async function dialogFits(): Promise<{ inside: boolean; overflow: string[] }> {
  return session!.page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')!;
    const box = panel.getBoundingClientRect();
    const overflow = [...panel.querySelectorAll("*")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5);
      })
      .map((node) => `${node.tagName}.${node.className}: ${node.textContent?.slice(0, 30)}`);
    return { inside: box.top >= 0 && box.bottom <= window.innerHeight, overflow };
  });
}

const LABELS = { en: { more: "More", share: "Share" }, ru: { more: "Ещё", share: "Поделиться" } };

async function openPlaylist(id: string): Promise<void> {
  await session!.go(`#/library/playlist?id=${encodeURIComponent(id)}`);
  await session!.page.locator("[data-track-row]").first().waitFor({ timeout: 15_000 });
}

async function playlistMenuShare(id: string, locale: "en" | "ru" = "en"): Promise<void> {
  const page = session!.page;
  await openPlaylist(id);
  await page.locator(`button[aria-label="${LABELS[locale].more}"]:not([data-track-row] *)`).first().click();
  await page.getByRole("menuitem", { name: LABELS[locale].share }).click();
  await page.getByRole("dialog").waitFor({ timeout: 10_000 });
}

describe("sharing", () => {
  it("previews shared playlists, shares songs and playlists, and opens arriving links", async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    session = await launchNuvo({ profile: "seeded", locale: "en" });
    const { page, app } = session;
    // fixtures only: the renderer stays offline, so a looked-up song is gone and nothing reaches the network
    await app.evaluate(({ session: electronSession }) => electronSession.defaultSession.enableNetworkEmulation({ offline: true }));

    const road = (await session.core(
      `const tracks = ${JSON.stringify(youtubeIds(40, 5).map((id, index) => ({ ...trackSnapshot(index + 1), id })))};
       const created = await (await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: "Road trip" }) })).json();
       await fetch(base + "/v1/me/playlists/" + created.id + "/tracks", { method: "POST", headers: json, body: JSON.stringify({ tracks }) });
       return created.id;`,
    )) as string;
    const full = await fullLink();
    const lean = await leanLink();
    expect(full.length).toBeLessThan(1_800);

    const files: string[] = [];
    for (const look of [LIGHT, DARK]) {
      await session.setLook(look);
      await session.setSize(WIDE);

      await arrive(full);
      expect(page.url()).toContain("#/search");
      const preview = await page.getByRole("dialog").textContent();
      expect(preview).toContain("Вечерний плейлист");
      expect(preview).toContain("40 songs");
      expect(preview).toContain("Группа крови");
      expect(await dialogFits()).toEqual({ inside: true, overflow: [] });
      files.push(await shot(`preview-full40-${look.mode}-1200`));
      await closeDialog();
      expect(await page.locator("input").first().inputValue()).toBe("");

      await arrive(lean);
      await page.getByText("Unavailable song").waitFor({ timeout: 15_000 });
      expect(await page.getByRole("dialog").textContent()).toContain("Archangel");
      files.push(await shot(`preview-lean-gone-${look.mode}-1200`));
      await closeDialog();

      await openPlaylist(session.seed!.smallPlaylistId);
      // one song, from a track row's menu
      await page.locator("[data-track-row]").first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Share" }).click();
      await page.getByRole("button", { name: "Copy link" }).waitFor({ timeout: 10_000 });
      expect(await page.getByRole("dialog").getByRole("button", { name: "Copy as text" }).count()).toBe(0);
      files.push(await shot(`share-song-${look.mode}-1200`));
      await closeDialog();

      await playlistMenuShare(road);
      await page.getByRole("button", { name: "Copy YouTube link" }).waitFor({ timeout: 10_000 });
      expect(await page.getByRole("dialog").textContent()).toContain("Road trip · 40 songs");
      expect(await dialogFits()).toEqual({ inside: true, overflow: [] });
      files.push(await shot(`share-40-${look.mode}-1200`));
      await closeDialog();

      // 300 seeded songs without a source id: the long-link notice sits above the actions
      await playlistMenuShare(session.seed!.bigPlaylistId);
      await page.getByRole("button", { name: "Copy long link" }).waitFor({ timeout: 10_000 });
      const sheet = (await page.getByRole("dialog").textContent()) ?? "";
      expect(sheet.indexOf("long link (")).toBeGreaterThan(-1);
      expect(sheet.indexOf("long link (")).toBeLessThan(sheet.indexOf("Copy long link"));
      expect(await dialogFits()).toEqual({ inside: true, overflow: [] });
      files.push(await shot(`share-300-${look.mode}-1200`));
      await closeDialog();
    }

    // Russian at the short window
    await page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await session.setLook(LIGHT);
    await session.setSize(NARROW);
    await arrive(full);
    expect(await page.getByRole("dialog").textContent()).toContain("40 треков");
    expect(await dialogFits()).toEqual({ inside: true, overflow: [] });
    files.push(await shot("preview-full40-ru-light-1100"));
    await closeDialog();
    await arrive(lean);
    await page.getByText("Трек недоступен").waitFor({ timeout: 15_000 });
    files.push(await shot("preview-lean-gone-ru-light-1100"));
    await closeDialog();
    await playlistMenuShare(road, "ru");
    await page.getByRole("button", { name: "Скопировать ссылку YouTube" }).waitFor({ timeout: 10_000 });
    expect(await dialogFits()).toEqual({ inside: true, overflow: [] });
    files.push(await shot("share-40-ru-light-1100"));
    await closeDialog();
    await playlistMenuShare(session.seed!.bigPlaylistId, "ru");
    await page.getByRole("button", { name: "Скопировать длинную ссылку" }).waitFor({ timeout: 10_000 });
    expect(await dialogFits()).toEqual({ inside: true, overflow: [] });
    files.push(await shot("share-300-ru-light-1100"));
    await closeDialog();
    await page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));

    console.log(files.join("\n"));
  });
});
