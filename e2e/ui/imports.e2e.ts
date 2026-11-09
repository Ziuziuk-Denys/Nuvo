import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

const SHOTS = path.join(os.homedir(), ".cache", "imp-shots");
const LINK = "https://www.deezer.com/en/playlist/908622995";
const LOOKS = {
  en: {
    look: { preset: "nuvo", mode: "light" },
    size: { width: 1200, height: 780 },
    create: "Create playlist",
    fromLink: "From a link",
    cancel: "Cancel import",
    importing: /Importing… \d+ %/,
  },
  ru: {
    look: { preset: "nuvo", mode: "light" },
    size: { width: 1100, height: 705 },
    create: "Создать плейлист",
    fromLink: "Из ссылки",
    cancel: "Отменить импорт",
    importing: /Импорт… \d+ %/,
  },
} as const;

const SPOTIFY_LINK = "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U?si=e2e";
const SPOTIFY = {
  label: "Rock Classics",
  rows: Array.from({ length: 100 }, (_, i) => ({ title: `Classic ${i + 1}`, artists: ["Fleetwood Mac"], durationMs: 257_800 })),
  partial: true,
  total: 200,
};
const SPOTIFY_NOTICE = {
  en: "Spotify shows only the first 100 songs",
  ru: "Без аккаунта Spotify показывает только первые 100 песен",
} as const;

let session: NuvoSession | null = null;
afterAll(async () => {
  await session?.close();
});

async function blockNetwork(live: NuvoSession): Promise<void> {
  await live.page.route(/^https?:\/\/(?!(localhost|127\.0\.0\.1))/, () => new Promise<never>(() => undefined));
}

async function shot(live: NuvoSession, name: string, locale: "en" | "ru"): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await live.page.emulateMedia({ reducedMotion: "reduce" });
  await live.page.waitForTimeout(800);
  await live.page.screenshot({ path: path.join(SHOTS, `${name}-${locale}-${LOOKS[locale].size.width}.png`) });
}

async function closeDialog(live: NuvoSession): Promise<void> {
  await live.page.keyboard.press("Escape");
  await live.page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 10_000 });
}

async function fakeSpotifyRoute(live: NuvoSession): Promise<void> {
  await live.page.addInitScript((answer) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v1/spotify/import?")) return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
      return real(input, init);
    };
  }, SPOTIFY);
}

describe.each(["en", "ru"] as const)("Import entries (%s)", (locale) => {
  it("Search, New playlist and a running import's row", { timeout: 600_000 }, async () => {
    await session?.close();
    const spec = LOOKS[locale];
    session = await launchNuvo({ profile: "seeded" });
    const live = session;
    if (locale === "ru") {
      await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
      await live.page.reload();
      await live.page.waitForLoadState("domcontentloaded");
    }
    await blockNetwork(live);
    await live.setLook(spec.look);
    await live.setSize(spec.size);
    await blockNetwork(live);

    await live.go("#/search");
    const field = live.page.locator("input").first();
    await field.waitFor({ timeout: 15_000 });
    await field.fill(LINK);
    await field.press("Enter");
    await live.page.locator('[role="dialog"]').waitFor({ timeout: 15_000 });
    await shot(live, "search-sheet", locale);
    await closeDialog(live);

    await fakeSpotifyRoute(live);
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await blockNetwork(live);
    await live.go("#/search");
    await field.waitFor({ timeout: 15_000 });
    await field.fill(SPOTIFY_LINK);
    await field.press("Enter");
    const sheet = live.page.locator('[role="dialog"]');
    await sheet.getByRole("heading", { name: "Rock Classics" }).waitFor({ timeout: 15_000 });
    expect(await sheet.innerText()).toContain(SPOTIFY_NOTICE[locale]);
    expect(await sheet.innerText()).toContain("Classic 1 · Fleetwood Mac");
    await shot(live, "spotify-preview", locale);
    await sheet.getByRole("button", { name: locale === "en" ? "Import" : "Импортировать", exact: true }).click();
    const imported = async () =>
      (await live.core(
        `return (await (await fetch(base + "/v1/imports")).json()).items.filter((i) => i.sourceKind === "spotify").map((i) => [i.id, i.label, i.total]);`,
      )) as [string, string, number][];
    await expect.poll(async () => (await imported()).map(([, label, total]) => [label, total])).toEqual([["Rock Classics", 100]]);
    await shot(live, "spotify-started", locale);
    await closeDialog(live);
    await live.go("#/library");
    await live.page.getByText("Rock Classics", { exact: true }).first().waitFor({ timeout: 10_000 });
    await live.page.getByText(spec.importing).first().waitFor({ timeout: 10_000 });
    await live.page.locator('aside [data-nav="library"] [role="progressbar"]').waitFor({ timeout: 10_000 });
    await shot(live, "library-live", locale);
    const [[spotifyId]] = await imported();
    await live.core(`await fetch(base + "/v1/imports/${spotifyId}", { method: "DELETE" });`);

    await live.go("#/library");
    await live.page.getByRole("button", { name: spec.create }).first().click();
    await live.page.getByRole("button", { name: spec.fromLink }).waitFor({ timeout: 10_000 });
    await shot(live, "new-playlist", locale);
    await live.page.getByRole("button", { name: spec.fromLink }).click();
    await live.page.locator('[role="dialog"]').first().waitFor({ timeout: 10_000 });
    await live.page.waitForTimeout(500);
    expect(await live.page.locator('[role="dialog"]').count()).toBe(1);
    await shot(live, "new-playlist-sheet", locale);
    await closeDialog(live);

    await live.core(
      `const rows = Array.from({ length: 100 }, (_, i) => i < 12
         ? { title: "Song " + i, artists: ["Artist"], track: { id: "id" + i, title: "Song " + i, artists: [{ id: "", name: "Artist" }], durationMs: 200000 } }
         : { title: "Wait " + i, artists: ["Artist"] });
       const res = await fetch(base + "/v1/imports", { method: "POST", headers: json, body: JSON.stringify({ source: "deezer", label: "Road trip", rows, target: { kind: "new" } }) });
       if (!res.ok) throw new Error("import " + res.status);`,
    );
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await blockNetwork(live);
    await live.page.getByText(spec.importing).first().waitFor({ timeout: 30_000 });
    await shot(live, "library-importing-list", locale);
    await live.page.evaluate(() => localStorage.setItem("nuvo_library_view_mode", "grid"));
    await live.page.reload();
    await blockNetwork(live);
    await live.page.getByText(spec.importing).first().waitFor({ timeout: 30_000 });
    await shot(live, "library-importing-grid", locale);
    await live.page.evaluate(() => localStorage.setItem("nuvo_library_view_mode", "list"));
    await live.page.reload();
    await blockNetwork(live);
    await live.page.getByText(spec.importing).first().waitFor({ timeout: 30_000 });

    await live.page.locator('[role="button"]', { hasText: spec.importing }).first().click({ button: "right" });
    await live.page.getByRole("menuitem", { name: spec.cancel }).waitFor({ timeout: 10_000 });
    await shot(live, "library-importing-menu", locale);
    await live.page.getByRole("menuitem", { name: spec.cancel }).click();
    await expect.poll(() => live.page.getByText(spec.importing).count()).toBe(0);
  });
});
