import { afterEach, describe, expect, it } from "vitest";
import { launchNuvo, MATRIX, passFirstRun, SIZES, type Look, type NuvoSession } from "./harness";
import { seedPools } from "./seed";

const STEP = "home";
const W1200 = SIZES[0];
const W1100 = SIZES[1];
const WIDE = { width: 1600, height: 960 };
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };

let session: NuvoSession | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

async function homeState(live: NuvoSession) {
  await live.page.locator("[data-mix], [data-slot=cold-start]").first().waitFor({ timeout: 30_000 });
  await live.page.waitForTimeout(1_000);
  return live.page.evaluate(() => ({
    mixes: [...document.querySelectorAll<HTMLElement>("[data-mix]")].map((card) => card.dataset.mix),
    picks: document.querySelectorAll("[data-pick]").length,
    shelf: document.querySelectorAll("[data-shelf] [data-song]").length,
    glow: document.querySelector("[data-mode] img") !== null,
    glass: document.querySelector("[data-island][data-lit]") !== null,
    coldStart: document.querySelector("[data-slot=cold-start]") !== null,
  }));
}

async function shootRussian(live: NuvoSession, state: string): Promise<void> {
  await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
  await live.setLook({ preset: "nuvo", mode: "light" });
  await live.go("#/");
  await homeState(live);
  expect(await live.shoot(STEP, "home", state, { looks: [{ preset: "nuvo", mode: "light" }], sizes: [W1100] })).toHaveLength(1);
}

describe("home", () => {
  it("seeded: For you leads the mixes, recommendations only follow, the page glows and the bar turns to glass", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    await live.go("#/");
    const state = await homeState(live);
    console.log("home seeded:", JSON.stringify(state));
    expect(state.mixes[0]).toBe("daily-mix-for-you");
    expect(state.picks).toBe(0);
    expect(state.shelf).toBeGreaterThan(0);
    expect(state.glow).toBe(true);
    expect(state.glass).toBe(true);
    expect(state.coldStart).toBe(false);
    expect(await live.shoot(STEP, "home", "seeded", { looks: MATRIX, sizes: [W1200] })).toHaveLength(MATRIX.length);
    await shootRussian(live, "seeded-ru");
  }, 900_000);

  it("seeded with radio lists: every mix card opens a page with the mix's songs, New to you too", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    await seedPools(live);
    await live.page.reload();
    await live.go("#/");
    await live.page.locator("[data-mix=daily-mix-discover]").waitFor({ timeout: 30_000 });
    const mixes = await live.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-mix]")].map((card) => card.dataset.mix!));
    expect(mixes.slice(0, 2)).toEqual(["daily-mix-for-you", "daily-mix-discover"]);
    for (const id of mixes) {
      await live.go("#/");
      const card = live.page.locator(`[data-mix="${id}"]`);
      const caption = await card.innerText();
      await card.click();
      await live.page.locator("[data-track-row]").first().waitFor({ timeout: 15_000 });
      const page = await live.page.evaluate(() => ({
        title: document.querySelector("h1")?.textContent,
        rows: document.querySelectorAll("[data-track-row]").length,
      }));
      expect(page.title).toBeTruthy();
      expect(caption).toContain(page.title);
      expect(page.rows).toBeGreaterThanOrEqual(3);
    }
    await live.go("#/collection?type=playlist&id=daily-mix-discover");
    await live.page.locator("[data-track-row]").first().waitFor({ timeout: 15_000 });
    expect(await live.page.locator("h1").innerText()).toBe("Something new");
    expect(await live.shoot("mix-page", "mix", "discover", { looks: [LIGHT, DARK], sizes: [W1100, WIDE] })).toHaveLength(4);
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await live.page.locator("[data-track-row]").first().waitFor({ timeout: 30_000 });
    expect(await live.page.locator("h1").innerText()).toBe("Что-то новое");
    expect(await live.shoot("mix-page", "mix", "discover-ru", { looks: [LIGHT, DARK], sizes: [W1100] })).toHaveLength(2);
  }, 900_000);

  it("seeded with radio lists: a shuffle of the library and More like shelves fill in under Songs for you", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    await seedPools(live);
    await live.page.reload();
    await live.go("#/");
    await live.page.waitForFunction(() => document.querySelectorAll("[data-shelf=like]").length === 2, undefined, { timeout: 30_000 });
    const shelves = await live.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-shelf]")].map((shelf) => ({
        name: shelf.dataset.shelf,
        title: shelf.querySelector("h2")?.textContent,
        songs: [...shelf.querySelectorAll<HTMLElement>("[data-song]")].map((row) => row.dataset.song!),
        artists: [...shelf.querySelectorAll<HTMLElement>("[data-song]")].map((row) => row.innerText.split("\n")[1]),
      })),
    );
    console.log("home shelves:", JSON.stringify(shelves.map(({ name, title, songs }) => ({ name, title, songs: songs.length }))));
    expect(shelves.map((shelf) => shelf.name)).toEqual(["songs", "like", "shuffle", "like"]);
    const [, like, shuffle] = shelves;
    expect(shuffle.title).toBe("A shuffle of your music");
    expect(shuffle.songs).toHaveLength(4);
    expect(shuffle.songs.every((id) => /^seed-\d{4}$/.test(id))).toBe(true);
    const artist = like.title!.replace("More like ", "");
    expect(like.songs.length).toBeGreaterThanOrEqual(4);
    expect(like.artists).not.toContain(artist);
    const all = shelves.flatMap((shelf) => shelf.songs);
    expect(new Set(all).size).toBe(all.length);
    expect(await live.page.locator("[data-shelf=style]").count()).toBe(0);

    const shelvesInView = async () => {
      await live.page.locator("[data-shelf=like] [data-song]").first().waitFor({ timeout: 30_000 });
      await live.page
        .locator("[data-shelf=like]")
        .first()
        .evaluate((shelf) => {
          shelf.scrollIntoView({ block: "start" });
          let scroller = shelf.parentElement;
          while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
          scroller?.scrollBy(0, -72);
        });
    };
    expect(await live.shoot("home-shelves", "home", "shelves", { looks: [LIGHT, DARK], sizes: [W1100, WIDE], prepare: shelvesInView })).toHaveLength(4);
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await shelvesInView();
    expect(await live.page.locator("[data-shelf=shuffle] h2").innerText()).toBe("Ваша музыка вперемешку");
    expect(await live.page.locator("[data-shelf=like] h2").first().innerText()).toMatch(/^Похожее на /);
    expect(await live.shoot("home-shelves", "home", "shelves-ru", { looks: [LIGHT, DARK], sizes: [W1100, WIDE], prepare: shelvesInView })).toHaveLength(4);
  }, 900_000);

  it("seeded with radio lists: each shelf's refresh brings other songs in place, easing in, and Home's first paint waits for none of them", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    await seedPools(live);
    await live.page.reload();
    await live.go("#/");
    await live.page.waitForFunction(() => document.querySelectorAll("[data-shelf=like]").length === 2, undefined, { timeout: 30_000 });
    const songsOf = (name: string) =>
      live.page.evaluate(
        (shelf) => [...document.querySelector(`[data-shelf="${shelf}"]`)!.querySelectorAll<HTMLElement>("[data-song]")].map((row) => row.dataset.song!),
        name,
      );
    const everySong = () => live.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-song]")].map((row) => row.dataset.song!));

    await live.page.emulateMedia({ reducedMotion: "no-preference" });
    for (const name of ["songs", "shuffle", "like"]) {
      const before = await songsOf(name);
      await live.page.locator(`[data-shelf="${name}"] [data-refresh]`).first().click();
      await live.page.waitForFunction(
        ([shelf, old]) => {
          const ids = [...document.querySelector(`[data-shelf="${shelf}"]`)!.querySelectorAll<HTMLElement>("[data-song]")].map((row) => row.dataset.song!);
          return ids.length > 0 && ids.join() !== old;
        },
        [name, before.join()] as const,
        { timeout: 30_000 },
      );
      const opacity = await live.page.evaluate(
        (shelf) => Number(getComputedStyle(document.querySelector(`[data-shelf="${shelf}"] [data-song]:last-child`)!).opacity),
        name,
      );
      expect(opacity).toBeLessThan(1);
      const after = await songsOf(name);
      expect(after.length).toBeGreaterThanOrEqual(4);
      expect(after.filter((id) => before.includes(id))).toEqual([]);
    }
    const all = await everySong();
    expect(new Set(all).size).toBe(all.length);

    const headingInView = async () => {
      await live.page.locator("[data-shelf=shuffle] [data-song]").first().waitFor({ timeout: 30_000 });
      await live.page.locator("[data-shelf=songs]").evaluate((shelf) => shelf.scrollIntoView({ block: "start" }));
      await live.page.locator("[data-shelf=shuffle] [data-refresh]").hover();
    };
    expect(await live.shoot("home-refresh", "home", "refresh", { looks: [LIGHT, DARK], sizes: [W1100, WIDE], prepare: headingInView })).toHaveLength(4);
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await headingInView();
    expect(await live.page.locator("[data-shelf=shuffle] [data-refresh]").getAttribute("aria-label")).toBe("Показать другие");
    expect(await live.shoot("home-refresh", "home", "refresh-ru", { looks: [LIGHT, DARK], sizes: [W1100, WIDE], prepare: headingInView })).toHaveLength(4);
  }, 900_000);

  it("fresh: the cold-start slot alone, no glow", async () => {
    const live = await launchNuvo({ profile: "fresh" });
    session = live;
    await passFirstRun(live.page);
    await live.go("#/");
    const state = await homeState(live);
    console.log("home fresh:", JSON.stringify(state));
    expect(state.mixes).toEqual([]);
    expect(state.picks).toBe(0);
    expect(state.coldStart).toBe(true);
    expect(state.glow).toBe(false);
    const edges = await live.page.evaluate(() => {
      const box = (selector: string) => document.querySelector(`[aria-labelledby="cold-taste-title"] ${selector}`)!.getBoundingClientRect();
      const field = box('[role="search"]');
      const sources = [...document.querySelectorAll("[data-source]")].map((source) => source.getBoundingClientRect());
      return {
        field: [field.left, field.right],
        count: box('[role="status"]').left,
        listen: box('[role="status"] + button').right,
        importCentre: (sources[0].left + sources.at(-1)!.right) / 2,
        sources: sources.length,
      };
    });
    expect(edges.sources, "every import source offered").toBe(5);
    expect(Math.abs(edges.importCentre - (edges.field[0] + edges.field[1]) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.count - edges.field[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.listen - edges.field[1])).toBeLessThanOrEqual(1);
    expect(await live.shoot(STEP, "home", "fresh", { looks: MATRIX, sizes: [W1200] })).toHaveLength(MATRIX.length);
    await shootRussian(live, "fresh-ru");
  }, 900_000);
});
