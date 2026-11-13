import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { searchResponse, shelf, songRow } from "../../src/youtube/test/shapes";
import { launchNuvo, type NuvoSession } from "./harness";

const SHOTS = path.join(os.homedir(), ".cache", "search-shots");
const TEXT = {
  en: { mark: "From SoundCloud", preview: "Preview", songs: "Songs", all: "All", everywhere: "Everywhere", sources: "Sources" },
  ru: { mark: "Из SoundCloud", preview: "Отрывок", songs: "Треки", all: "Всё", everywhere: "Везде", sources: "Источники" },
} as const;

const SOUNDCLOUD = {
  items: [
    { id: "sc:88335161", title: "Get Lucky [Original Version] - Daft Punk", artists: [{ id: "sc_user_9", name: "DJ KB" }], durationMs: 246_381 },
    { id: "sc:2360861477", title: "Daft Punk - Get Lucky #nightcore", artists: [{ id: "sc_user_8", name: "999333" }], durationMs: 107_822 },
    {
      id: "sc:254111945",
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      artists: [{ id: "sc_user_7", name: "Daft Punk" }],
      durationMs: 30_000,
      preview: true,
    },
  ],
};

const YOUTUBE = searchResponse(
  shelf(
    songRow({ id: "vidLUCKY0001", title: "Get Lucky", artists: [["Daft Punk", "UCdaftpunk0000000000000001"]], duration: "6:10" }),
    songRow({ id: "vidLUCKY0002", title: "Get Lucky (Radio Edit)", artists: [["Daft Punk", "UCdaftpunk0000000000000001"]], duration: "4:08" }),
  ),
);

let session: NuvoSession | null = null;
afterAll(async () => {
  await session?.close();
});

async function answerFromFixtures(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!(localhost|127\.0\.0\.1))/, (route) => route.fulfill({ status: 404 }));
  await page.addInitScript(
    ({ soundcloud, youtube }) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      const real = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("nuvo-core://local/v1/sc/search?")) return json(soundcloud);
        if (url.includes("generate_204")) return new Response(null, { status: 204 });
        if (url.includes("/youtubei/v1/search")) return json(youtube);
        if (/^https?:\/\/([a-z0-9-]+\.)*(youtube|ytimg|googlevideo|googleusercontent|soundcloud|sndcdn)\.com\//.test(url))
          return new Response("", { status: 404 });
        return real(input, init);
      };
    },
    { soundcloud: SOUNDCLOUD, youtube: YOUTUBE },
  );
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

describe.each(["en", "ru"] as const)("Search with SoundCloud (%s)", (locale) => {
  it("shows SoundCloud songs beside YouTube ones and filters by source", { timeout: 600_000 }, async () => {
    await session?.close();
    session = await launchNuvo({ profile: "seeded" });
    const page = session.page;
    const text = TEXT[locale];
    await page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
    await answerFromFixtures(page);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await session.setSize({ width: 1200, height: 780 });

    await session.go("#/search");
    const field = page.locator("input").first();
    await field.waitFor({ timeout: 15_000 });
    await field.fill("get lucky");
    const group = page.locator('section[aria-label="SoundCloud"]');
    await group.waitFor({ timeout: 15_000 });
    await expect.poll(() => group.locator('[role="button"]').count()).toBe(3);
    expect(await group.getByRole("img", { name: text.mark }).count()).toBe(3);
    expect(await group.getByText(text.preview, { exact: true }).count()).toBe(1);
    expect(await page.getByText("Get Lucky (Radio Edit)").count()).toBe(1);
    await shot(page, `all-${locale}`);

    await page.getByRole("button", { name: `${text.sources}: ${text.everywhere}` }).click();
    await shot(page, `menu-${locale}`);
    await page.getByRole("menuitem", { name: "SoundCloud" }).click();
    const kinds = page.getByRole("tablist").first().getByRole("tab");
    await expect.poll(() => kinds.allInnerTexts()).toEqual([text.all, text.songs]);
    await expect.poll(() => page.getByText("Get Lucky (Radio Edit)").count()).toBe(0);
    expect(await page.getByRole("img", { name: text.mark }).count()).toBe(3);
    await shot(page, `soundcloud-${locale}`);

    await page.getByRole("button", { name: `${text.sources}: SoundCloud` }).click();
    await page.getByRole("menuitem", { name: "YouTube" }).click();
    await expect.poll(() => page.getByRole("img", { name: text.mark }).count()).toBe(0);
    await page.getByText("Get Lucky (Radio Edit)").first().waitFor({ timeout: 15_000 });
  });
});
