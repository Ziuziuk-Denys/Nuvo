import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { SEARCH_PARAMS } from "../../src/youtube/constants";
import { artistRun, browseRow, nextResponse, queueRow, run, searchResponse, SEP, shelf, songRow, thumb } from "../../src/youtube/test/shapes";
import { launchNuvo, passFirstRun, type Look, type NuvoSession } from "./harness";
import { coverBase, seedLibrary } from "./seed";

/** Runs against a `pnpm build`: cold start on Home, the hidden list in Settings, suggestions under a playlist. No traffic leaves the machine. */
const STEP = "recs-ui";
const SHOTS = path.join(os.homedir(), ".cache", "recs-shots");
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };
const W1200 = { width: 1200, height: 780 };
const W1100 = { width: 1100, height: 705 };

const ARTISTS = [
  ["UCnova000000000000000001", "Nova Lights"],
  ["UCnova000000000000000002", "Nova Drift"],
  ["UCnova000000000000000003", "Novaya Volna"],
  ["UCnova000000000000000004", "Nova Harbor"],
] as const;

let session: NuvoSession | null = null;
afterAll(async () => {
  await session?.close();
});

/** InnerTube answers for artist search, artist pages and radio lists, built from the catalog tests' shapes. */
async function fixtures() {
  const port = await coverBase();
  const cover = (seed: number) => `http://127.0.0.1:${port}/${seed}.svg`;
  const artistSearch = searchResponse(
    shelf(
      ...ARTISTS.map(([id, name], i) =>
        browseRow("ARTIST", id, name, [run("Artist"), SEP, run(`${i + 1}M monthly audience`)], thumb(cover(300 + i), 120, 120)),
      ),
    ),
  );
  const artistPages = Object.fromEntries(
    ARTISTS.map(([id, name], a) => [
      id,
      {
        contents: {
          singleColumnBrowseResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          musicShelfRenderer: {
                            title: { runs: [run("Top songs")] },
                            contents: Array.from({ length: 5 }, (_, i) =>
                              songRow({
                                id: `vidART${a}SONG${i}`,
                                title: `${name} song ${i + 1}`,
                                artists: [[name, id]],
                                duration: "3:1" + i,
                                thumbnail: thumb(cover(310 + a * 5 + i), 120, 120),
                              }),
                            ),
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
        header: { musicImmersiveHeaderRenderer: { title: { runs: [run(name)] }, thumbnail: thumb(cover(300 + a), 900, 900) } },
      },
    ]),
  );
  const radioTitles = [
    "Paper Moons",
    "Low Tide Static",
    "Glass Orchard",
    "Neon Harvest",
    "Quiet Engines",
    "Velvet Signal",
    "Salt Lanterns",
    "Night Ferry",
    "Copper Skies",
    "Tin Roof Echo",
    "Slow Comet",
    "Amber Wires",
  ];
  const radio = nextResponse(
    ...radioTitles.map((title, i) => {
      const row = queueRow({
        id: `vidSUGG${String(i).padStart(4, "0")}`,
        title,
        byline: [artistRun(ARTISTS[i % 4][1], ARTISTS[i % 4][0])],
        length: `3:${String(10 + i).padStart(2, "0")}`,
      });
      (row.playlistPanelVideoRenderer as Record<string, unknown>).thumbnail = { thumbnails: [{ url: cover(400 + i), width: 120, height: 120 }] };
      return row;
    }),
  );
  return { artistSearch, artistPages, radio, artistParams: SEARCH_PARAMS.artist };
}

/** Patches fetch before the app runs on every load: YouTube hosts answer from the fixtures or 404, the probe says online. */
async function installFixtures(page: Page): Promise<void> {
  const data = await fixtures();
  await page.route(/^https?:\/\/([a-z0-9-]+\.)*(youtube|ytimg|googlevideo|googleusercontent|soundcloud|sndcdn)\.com\//, (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.addInitScript((fx) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    const real = window.fetch.bind(window);
    const sw = `)]}'\n${JSON.stringify([[null, null, [[[null, null, null, null, null, null, null, null, null, null, null, null, null, "CgsAAAAAAAAAAAAAAAAAAAAAAAA%3D%3D"]]]]])}`;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        return real(input, init);
      }
      if (!/(^|\.)(youtube|ytimg|googlevideo|googleusercontent|soundcloud|sndcdn)\.com$/.test(host)) return real(input, init);
      if (url.includes("generate_204")) return new Response(null, { status: 204 });
      if (url.includes("sw.js_data")) return new Response(sw);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { params?: string; browseId?: string }) : {};
      if (url.includes("/youtubei/v1/search")) return json(body.params === fx.artistParams ? fx.artistSearch : { contents: {} });
      if (url.includes("/youtubei/v1/browse") && body.browseId && fx.artistPages[body.browseId]) return json(fx.artistPages[body.browseId]);
      if (url.includes("/youtubei/v1/next")) return json(fx.radio);
      return new Response("", { status: 404 });
    };
  }, data);
}

async function shoot(
  live: NuvoSession,
  screen: string,
  state: string,
  looks: Look[],
  sizes: { width: number; height: number }[],
  prepare?: () => Promise<void>,
): Promise<string[]> {
  const files = await live.shoot(STEP, screen, state, { looks, sizes, prepare });
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const file of files) fs.copyFileSync(file, path.join(SHOTS, path.basename(file)));
  return files.map((file) => path.join(SHOTS, path.basename(file)));
}

async function setLocale(live: NuvoSession, locale: "en" | "ru"): Promise<void> {
  await live.page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
}

describe("recs UI", () => {
  it("cold start on Home, the hidden list with Show again, suggestions under a playlist", async () => {
    const live = await launchNuvo({ profile: "fresh", locale: "en" });
    session = live;
    const page = live.page;
    page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 300)));
    await installFixtures(page);
    await page.reload();
    await passFirstRun(page);

    // cold start: the daemon says nothing tells the taste, the tour is gone, the catalog answers
    const needed = await live.core(`return (await (await fetch(base + "/v1/recs/start")).json()).needed;`);
    expect(needed).toBe(true);
    const title = page.getByRole("heading", { name: "Start with a few artists you like" });
    await title.waitFor({ timeout: 20_000 });
    console.log(await shoot(live, "home", "cold-empty", [LIGHT, DARK], [W1200], () => title.waitFor({ timeout: 20_000 })));

    const pickTwo = async () => {
      await page.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 20_000 });
      await page.locator('input[aria-label="Search artists"], input[aria-label="Поиск исполнителей"]').fill("nova");
      await page.getByText("Nova Lights", { exact: true }).waitFor({ timeout: 15_000 });
      await page.getByText("Nova Lights", { exact: true }).click();
      await page.getByText("Nova Drift", { exact: true }).click();
      await page.mouse.move(30, 400);
    };
    await pickTwo();
    expect(await page.locator('[aria-current="true"]').count()).toBe(2);
    console.log(await shoot(live, "home", "cold-picked", [LIGHT, DARK], [W1200], pickTwo));
    await setLocale(live, "ru");
    console.log(
      await shoot(live, "home", "cold-picked-ru", [{ ...LIGHT }], [W1100], async () => {
        await page.reload();
        await page.getByRole("heading", { name: "Начните с нескольких любимых исполнителей" }).waitFor({ timeout: 20_000 });
        await page.locator('input[aria-label="Search artists"], input[aria-label="Поиск исполнителей"]').fill("nova");
        await page.getByText("Nova Lights", { exact: true }).click();
        await page.getByText("Nova Drift", { exact: true }).click();
        await page.getByText("Novaya Volna", { exact: true }).click();
        await page.mouse.move(30, 400);
      }),
    );
    // the fit at 1100 in Russian: nothing in the foot clips
    const foot = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Слушать")!;
      return { clipped: button.scrollWidth > button.clientWidth, right: button.getBoundingClientRect().right, width: innerWidth };
    });
    expect(foot.clipped).toBe(false);
    expect(foot.right).toBeLessThan(foot.width);
    await page.getByRole("button", { name: "Слушать" }).click();
    await page.getByRole("heading", { name: "Начните с нескольких любимых исполнителей" }).waitFor({ state: "detached", timeout: 30_000 });
    const after = await live.core(`return (await (await fetch(base + "/v1/recs/start")).json()).needed;`);
    expect(after, "the starters answered the ask").toBe(false);
    // the station plays at once, so Home shows its mix rather than an empty state
    await page.locator("[data-mix]").first().waitFor({ timeout: 30_000 });
    expect(await page.locator("[data-slot=cold-start]").count()).toBe(0);
    await page.waitForTimeout(1_500);
    console.log(await shoot(live, "home", "after-start-ru", [LIGHT], [W1100]));
    await setLocale(live, "en");

    // the hidden list: three entries the way "Not interested" makes them
    const seed = await seedLibrary(live);
    const coverPort = await coverBase();
    await live.core(`
      const snap = (i, title, artist) => ({ id: "hid-" + i, title, artists: [{ id: "UChid" + i, name: artist }], durationMs: 200000, cover: { url: "http://127.0.0.1:${coverPort}/" + (500 + i) + ".svg", width: 120, height: 120 } });
      const tracks = [snap(1, "Roygbiv", "Boards of Canada"), snap(2, "Windowlicker", "Aphex Twin"), snap(3, "Teardrop", "Massive Attack")];
      const scopes = ["exact", "work", "artist_forever"];
      for (let i = 0; i < 3; i++) {
        const res = await fetch(base + "/v1/recs/not-interested", { method: "POST", headers: json, body: JSON.stringify({ trackId: tracks[i].id, scope: scopes[i], track: tracks[i] }) });
        if (!res.ok) throw new Error("not-interested " + res.status);
      }`);
    // a reload first: the settings panel over Home would cover the link
    const openHidden = async () => {
      await page.reload();
      await live.go("#/");
      await page.getByRole("button", { name: /^(Hidden from recommendations|Скрыто из рекомендаций)$/ }).click({ timeout: 20_000 });
      await page
        .locator("[role=dialog] h2")
        .filter({ hasText: /Hidden music|Скрытая музыка/ })
        .waitFor();
      await page
        .getByText(/Roygbiv/)
        .first()
        .waitFor({ timeout: 15_000 });
    };
    await openHidden();
    await live.setSize(W1200);
    console.log("viewport before hidden shots:", await page.evaluate(() => [innerWidth, innerHeight]));
    console.log(await shoot(live, "settings", "hidden", [LIGHT, DARK], [W1200], openHidden));
    await setLocale(live, "ru");
    console.log(await shoot(live, "settings", "hidden-ru", [LIGHT], [W1100], openHidden));
    await page.getByRole("button", { name: "Вернуть", exact: true }).first().click();
    // newest first: the first row is the artist hidden last
    await page.getByText("Massive Attack").waitFor({ state: "detached", timeout: 10_000 });
    const left = (await live.core(`return (await (await fetch(base + "/v1/recs/suppressions")).json()).items.length;`)) as number;
    expect(left, "Show again removed one entry in the daemon").toBe(2);
    await setLocale(live, "en");
    await page.reload();

    // suggestions under an own playlist
    const playlistUrl = `#/library/playlist?id=${seed.smallPlaylistId}`;
    const openSuggestions = async () => {
      await live.go(playlistUrl);
      const section = page.locator("section[aria-label]").filter({ has: page.getByRole("heading", { name: /^(Suggestions|Предложения)$/ }) });
      await section.waitFor({ timeout: 30_000 });
      // the playlist's last rows above the section, clear of the top bar
      await page
        .locator("[data-reorder-item]")
        .last()
        .evaluate((el) => {
          el.scrollIntoView({ block: "start" });
          let box = el.parentElement;
          while (box && box.scrollTop === 0) box = box.parentElement;
          box?.scrollBy(0, -150);
        });
      await page.waitForTimeout(400);
      await page.mouse.move(30, 400);
    };
    await openSuggestions();
    const rows = await page.locator("section[aria-label=Suggestions] [data-track-row]").count();
    console.log("suggestion rows:", rows);
    expect(rows).toBeGreaterThan(0);
    console.log(await shoot(live, "playlist", "suggestions", [LIGHT, DARK], [W1200], openSuggestions));
    await setLocale(live, "ru");
    console.log(
      await shoot(live, "playlist", "suggestions-ru", [LIGHT], [W1100], async () => {
        await page.reload();
        await openSuggestions();
      }),
    );
    await setLocale(live, "en");
    await page.reload();
    await openSuggestions();

    // add one, then Not interested on the next, then Refresh
    const section = page.locator("section[aria-label=Suggestions]");
    const before = (await live.core(`return (await (await fetch(base + "/v1/me/playlists/${seed.smallPlaylistId}")).json()).items.length;`)) as number | null;
    const firstTitle = await section.locator("[data-track-row]").first().locator("span").nth(2).innerText();
    await section.getByRole("button", { name: "Add to this playlist", exact: true }).first().click();
    await page.waitForTimeout(1_500);
    const added = (await live.core(`return (await (await fetch(base + "/v1/me/playlists/${seed.smallPlaylistId}")).json()).items.length;`)) as number | null;
    console.log("playlist tracks before/after add:", before, added, "added:", firstTitle);
    expect(added, "the pick is in the playlist").toBe((before ?? 0) + 1);
    await section.getByText(firstTitle, { exact: true }).waitFor({ state: "detached", timeout: 10_000 });
    const count = await section.locator("[data-track-row]").count();
    await section.getByRole("button", { name: "Dislike", exact: true }).first().click();
    await expect.poll(() => section.locator("[data-track-row]").count()).toBe(count - 1);
    await section.locator("[data-track-row]").first().click({ button: "right" });
    await page.getByRole("menuitem").first().waitFor();
    console.log(await shoot(live, "playlist", "suggestions-menu", [LIGHT], [W1200], async () => undefined));
    await page.getByRole("menuitem").first().click();
    await expect.poll(() => section.locator("[data-track-row]").count()).toBe(count - 2);
    await section.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.waitForTimeout(1_500);
    console.log("after refresh:", await section.locator("[data-track-row]").count());
  }, 900_000);
});
