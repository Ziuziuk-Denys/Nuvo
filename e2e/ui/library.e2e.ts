import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { COVER, ROW, contentLeft } from "../../src/ui/geometry";
import { launchNuvo, MATRIX, passFirstRun, SIZES, type NuvoSession } from "./harness";
import { LONG_RU } from "./seed";

const STEP = "2-library";
const TABS = ["all", "playlists", "albums", "artists"] as const;

let session: NuvoSession | null = null;
let russian: NuvoSession | null = null;
let fresh: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
  await russian?.close();
  await fresh?.close();
});

async function setView(page: Page, view: "list" | "grid"): Promise<void> {
  await page.evaluate((value) => localStorage.setItem("nuvo_library_view_mode", value), view);
}

async function openTab(live: NuvoSession, tab: (typeof TABS)[number]): Promise<void> {
  await live.go(`#/library?tab=${tab}`);
  // the route keeps its component across a hash change, so reload to apply the tab and the view
  await live.page.reload();
  await live.page.waitForLoadState("domcontentloaded");
  await live.page.locator("h1").first().waitFor({ timeout: 15_000 });
  await live.page.waitForTimeout(600);
}

interface Layout {
  titleX: number;
  coverXs: number[];
  rowHeights: number[];
  overflow: string[];
  cards: number;
  gridRight: number;
  columnRight: number;
  tileWidths: number[];
}

/** Where the title and every visible cover start, row heights, and anything wider than its row. */
async function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const title = document.querySelector("h1")!.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>('[role="button"]')].filter((row) => row.closest("[style*='translateY']"));
    const overflow = rows.flatMap((row) => {
      const box = row.getBoundingClientRect();
      return [...row.querySelectorAll("*")]
        .filter((child) => {
          const rect = child.getBoundingClientRect();
          return rect.width > 0 && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5);
        })
        .map((child) => `${row.textContent?.slice(0, 30)}: ${child.className}`);
    });
    const tiles = [...document.querySelectorAll<HTMLElement>("button[data-kind]")];
    // tile -> grid (or a virtual grid row) -> its container in the content column
    const column = tiles[0]?.closest("[data-view]")?.getBoundingClientRect();
    // a card is a raised or bordered box around an entry
    const cards = [...rows, ...tiles].filter((node) => {
      const style = getComputedStyle(node);
      return style.boxShadow !== "none" || style.borderTopWidth !== "0px";
    }).length;
    return {
      titleX: title.x,
      coverXs: rows.map((row) => row.firstElementChild!.getBoundingClientRect().x),
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      overflow,
      cards,
      gridRight: tiles.length ? Math.max(...tiles.map((tile) => tile.getBoundingClientRect().right)) : 0,
      columnRight: column?.right ?? 0,
      tileWidths: tiles.map((tile) => tile.getBoundingClientRect().width),
    };
  });
}

/** The empty state sits in the middle of the page's width and fills the rest of the window without making it scroll. */
async function expectCentred(page: Page, where: string, selector = "[data-empty-state]"): Promise<void> {
  const box = await page.evaluate((selector) => {
    const area = document.querySelector(selector)!;
    const scroller = area.closest(".n-scroll")!;
    const outer = area.getBoundingClientRect();
    const heading = area.querySelector("h2")!.getBoundingClientRect();
    return {
      offset: heading.left + heading.width / 2 - (outer.left + outer.width / 2),
      spill: scroller.scrollHeight - scroller.clientHeight,
      depth: (heading.top - outer.top) / outer.height,
    };
  }, selector);
  expect(Math.abs(box.offset), `${where}: centred across`).toBeLessThanOrEqual(1);
  expect(box.spill, `${where}: no scroll`).toBeLessThanOrEqual(0);
  expect(box.depth, `${where}: centred down`).toBeGreaterThan(0.2);
}

describe("Library", () => {
  it("list and grid for every tab in every look and size", { timeout: 1_500_000 }, async () => {
    session = await launchNuvo({ profile: "seeded" });
    const live = session;
    for (const view of ["list", "grid"] as const) {
      for (const tab of TABS) {
        const prepare = async () => {
          await setView(live.page, view);
          await openTab(live, tab);
        };
        await prepare();
        for (const size of SIZES) {
          await live.setSize(size);
          await live.page.waitForTimeout(300);
          const layout = await measure(live.page);
          const where = `${view} ${tab} ${size.width}`;
          expect(layout.titleX, `${where}: title on the gutter`).toBe(contentLeft(size.width));
          expect(layout.cards, `${where}: no cards`).toBe(0);
          if (view === "list") {
            expect(layout.coverXs.length, `${where}: rows render`).toBeGreaterThan(0);
            for (const x of layout.coverXs) expect(x, `${where}: cover on the gutter`).toBe(contentLeft(size.width));
            for (const height of layout.rowHeights) expect(height, `${where}: row height`).toBe(ROW.list);
            expect(layout.overflow, `${where}: nothing spills out of a row`).toEqual([]);
          } else {
            for (const width of layout.tileWidths) expect(width, `${where}: tile width`).toBeGreaterThanOrEqual(COVER.gridMin);
            expect(layout.gridRight, `${where}: grid ends inside the column`).toBeLessThanOrEqual(layout.columnRight + 0.5);
          }
        }
        await live.shoot(STEP, `library-${tab}`, view, { prepare });
      }
    }
  });

  it("ru at 1100 with a 60-character playlist title keeps every row's controls inside", { timeout: 600_000 }, async () => {
    // the first-run helper reads English labels, so a seeded profile switches to Russian afterwards
    await session?.close();
    session = null;
    russian = await launchNuvo({ profile: "seeded" });
    const live = russian;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.core(
      `const res = await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: ${JSON.stringify(LONG_RU)} }) });
       if (!res.ok) throw new Error("playlist " + res.status);`,
    );
    const size = SIZES.find((entry) => entry.width === 1100)!;
    const looks = [
      { preset: "nuvo", mode: "light" },
      { preset: "nuvo", mode: "dark" },
    ] as const;
    for (const view of ["list", "grid"] as const) {
      const prepare = async () => {
        await setView(live.page, view);
        await openTab(live, "playlists");
        await live.page.getByText(LONG_RU).first().waitFor({ timeout: 15_000 });
      };
      await live.setLook(looks[0]);
      await prepare();
      await live.setSize(size);
      await live.page.waitForTimeout(300);
      const layout = await measure(live.page);
      expect(layout.overflow, `ru ${view}: nothing spills out of a row`).toEqual([]);
      // the tools never wrap under the tabs or cover them
      const bar = await live.page.evaluate(() => {
        const tabs = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
        const field = document.querySelector('input[type="text"]')!.getBoundingClientRect();
        return { tabsRight: tabs.right, fieldLeft: field.left, sameLine: Math.abs(tabs.top - field.top) < 24 };
      });
      expect(bar.tabsRight, `ru ${view}: tabs and filter do not overlap`).toBeLessThan(bar.fieldLeft);
      expect(bar.sameLine, `ru ${view}: tools share the tab row`).toBe(true);
      await live.shoot(STEP, "library-ru-long", view, { looks: [...looks], sizes: [size], prepare });
    }

    // the cover glow: a hovered row, a row with its menu open, and a hovered tile
    const wide = SIZES.find((entry) => entry.width === 1200)!;
    const states = [
      { view: "list", state: "hover", act: () => live.page.locator('[role="button"]').nth(2).hover() },
      { view: "list", state: "menu", act: () => live.page.locator('[role="button"]').nth(2).click({ button: "right" }) },
      { view: "grid", state: "hover", act: () => live.page.locator("button[data-kind]").nth(2).hover() },
    ] as const;
    for (const { view, state, act } of states) {
      const prepare = async () => {
        await setView(live.page, view);
        await openTab(live, "all");
        await live.page.emulateMedia({ reducedMotion: "reduce" });
        await act();
        await live.page.waitForTimeout(400);
      };
      await live.setLook(looks[0]);
      await prepare();
      await live.shoot(STEP, "library-glow", `${view}-${state}`, { looks: [...looks], sizes: [wide], prepare });
    }
  });

  it("empty library, empty tab and no match in every look", { timeout: 1_200_000 }, async () => {
    await session?.close();
    await russian?.close();
    session = null;
    russian = null;
    fresh = await launchNuvo({ profile: "fresh" });
    const live = fresh;
    await passFirstRun(live.page);
    const nuvo = MATRIX.filter((look) => look.preset === "nuvo");
    const wide = SIZES.filter((size) => size.width === 1200);
    const narrow = SIZES.filter((size) => size.width === 1100);
    const both = async (screen: string, prepare: () => Promise<void>) => {
      await live.shoot(STEP, screen, "state", { sizes: wide, prepare });
      await live.shoot(STEP, screen, "state", { looks: nuvo, sizes: narrow, prepare });
    };

    // nothing liked, made or saved: the welcome, with nothing overlapping at either width
    const empty = async () => {
      await setView(live.page, "list");
      await openTab(live, "all");
      await live.page.getByRole("button", { name: "Create playlist" }).first().waitFor({ timeout: 15_000 });
    };
    await empty();
    for (const size of SIZES) {
      await live.setSize(size);
      const box = await live.page.evaluate(() => {
        const heading = document.querySelector("h2")!.getBoundingClientRect();
        const buttons = [...document.querySelectorAll("h2 ~ div button")].map((node) => node.getBoundingClientRect());
        return { headingBottom: heading.bottom, buttonsTop: Math.min(...buttons.map((rect) => rect.top)), count: buttons.length };
      });
      expect(box.count, `empty ${size.width}: both actions`).toBe(2);
      expect(box.headingBottom, `empty ${size.width}: actions below the copy`).toBeLessThan(box.buttonsTop);
      await expectCentred(live.page, `library ${size.width}`);
    }
    await both("library-empty", empty);
    // Statistics with no plays yet uses the same centred empty state
    await live.go("#/stats");
    await live.page.locator("[data-testid=stats-empty] [data-empty-state]").waitFor({ timeout: 15_000 });
    await expectCentred(live.page, "stats");
    // Home before any artist is picked or anything imported: the artist ask is centred the same way, at both widths
    await live.go("#/");
    await live.page.locator("[data-cold-ask]").waitFor({ timeout: 30_000 });
    for (const size of SIZES) {
      await live.setSize(size);
      await expectCentred(live.page, `home ask ${size.width}`, "[data-cold-ask]");
    }

    // one playlist and nothing else: the Albums tab names what is missing
    await live.core(
      `const res = await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: "Morning" }) });
       if (!res.ok) throw new Error("playlist " + res.status);`,
    );
    const emptyTab = async () => {
      await setView(live.page, "list");
      await openTab(live, "albums");
      await live.page.getByText("No albums yet.").waitFor({ timeout: 15_000 });
    };
    await emptyTab();
    await both("library-empty-tab", emptyTab);

    // a long query that matches nothing wraps beside its Clear filter and never under the tools
    const query = "a query that matches nothing in this library at all";
    const noMatch = async () => {
      await setView(live.page, "list");
      await openTab(live, "all");
      await live.page.locator('input[type="text"]').fill(query);
      await live.page.getByRole("button", { name: "Clear filter" }).waitFor({ timeout: 15_000 });
    };
    await noMatch();
    for (const size of SIZES) {
      await live.setSize(size);
      const line = await live.page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((node) => node.textContent === "Clear filter")!;
        const text = button.previousElementSibling!.getBoundingClientRect();
        const page = document.querySelector("[data-view]")!.getBoundingClientRect();
        return { textRight: text.right, pageRight: page.right, buttonRight: button.getBoundingClientRect().right };
      });
      expect(line.textRight, `no match ${size.width}: inside the column`).toBeLessThanOrEqual(line.pageRight + 0.5);
      expect(line.buttonRight, `no match ${size.width}: button inside the column`).toBeLessThanOrEqual(line.pageRight + 0.5);
    }
    await both("library-no-match", noMatch);
    await live.page.getByRole("button", { name: "Clear filter" }).click();
    expect(await live.page.locator('input[type="text"]').inputValue()).toBe("");
  });
});
