import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { FRAME, ISLAND, POPOVER, TOP_BAR, TOP_ROW, islandWidth } from "../../src/ui/geometry";
import { artistRun, nextResponse, queueRow, run, SEP } from "../../src/youtube/test/shapes";
import { launchNuvo, SIZES, type Look, type NuvoSession, type Size } from "./harness";
import { PLAYER_SESSION_KEY } from "./seed";

const STEP = "1-shell";

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
}

interface ChromeBoxes {
  bar: { y: number; height: number; regions: string[] };
  items: Rect[];
  pins: Rect[];
  field: Rect;
  settings: Rect;
  controls: Rect;
  contentTop: number;
  contentLeft: number;
  view: number;
}

async function measureChrome(page: Page): Promise<ChromeBoxes> {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const { x, y, width, height, right } = element.getBoundingClientRect();
      return { x, y, width, height, right };
    };
    const header = document.querySelector("header[data-window-drag]")!;
    const region = (element: Element) => getComputedStyle(element).getPropertyValue("-webkit-app-region");
    const content = document.querySelector(".n-scroll")!.getBoundingClientRect();
    return {
      bar: { ...box(header), regions: [header, ...header.querySelectorAll("a, button, input")].map(region) },
      items: [...header.querySelectorAll("nav a[data-nav]")].map(box),
      pins: [...header.querySelectorAll("nav a[data-pin]")].map(box),
      field: box(header.querySelector("input[role=combobox]")!.parentElement!),
      settings: box(header.querySelector('button[aria-pressed][data-nuvo-guard="grid"]')!),
      controls: box(header.querySelector("[data-window-controls]")!),
      contentTop: content.top,
      contentLeft: content.left,
      view: window.innerWidth,
    };
  });
}

async function checkGeometry(live: NuvoSession, where: string): Promise<void> {
  const middle = TOP_BAR.height / 2;
  for (const size of SIZES) {
    await live.setSize(size);
    await live.page.waitForTimeout(300);
    const m = await measureChrome(live.page);
    const at = `${where} ${size.width}`;
    expect(m.bar.y, `${at}: top bar at the top`).toBe(0);
    expect(m.bar.height, `${at}: top bar height`).toBe(TOP_BAR.height);
    const [band, ...controls] = m.bar.regions;
    expect(band, `${at}: the top band drags the window`).toBe("drag");
    expect(controls, `${at}: controls in the band stay clickable`).toEqual(controls.map(() => "no-drag"));
    expect(m.items, `${at}: four sections`).toHaveLength(4);
    m.items.forEach((item, index) => {
      expect([item.width, item.height], `${at}: section ${index} size`).toEqual([TOP_ROW.item, TOP_ROW.item]);
      expect(item.y + item.height / 2, `${at}: section ${index} on the bar's middle line`).toBe(middle);
      if (index > 0) expect(item.x, `${at}: section ${index} follows the one before`).toBeGreaterThanOrEqual(m.items[index - 1].right);
    });
    const lastLeft = m.pins.at(-1) ?? m.items.at(-1)!;
    expect(m.field.height, `${at}: field height`).toBe(TOP_ROW.field);
    expect(m.field.y + m.field.height / 2, `${at}: field on the middle line`).toBe(middle);
    expect(m.field.width, `${at}: field width`).toBeLessThanOrEqual(TOP_ROW.fieldMax);
    expect(m.field.x, `${at}: field clear of the sections and pins`).toBeGreaterThanOrEqual(lastLeft.right + 16);
    expect(m.field.right, `${at}: field clear of settings`).toBeLessThanOrEqual(m.settings.x - 16);
    expect(m.settings.y + m.settings.height / 2, `${at}: settings on the middle line`).toBe(middle);
    expect(m.controls.y + m.controls.height / 2, `${at}: window buttons on the middle line`).toBe(middle);
    expect(m.controls.right, `${at}: window buttons at the right inset`).toBe(m.view - TOP_BAR.controlsInset);
    expect(m.contentTop, `${at}: the page starts under the bar`).toBe(TOP_BAR.height);
    expect(m.contentLeft, `${at}: the page spans the window`).toBe(FRAME);
  }
}

const NUVO_LOOKS: Look[] = [
  { preset: "nuvo", mode: "light" },
  { preset: "nuvo", mode: "dark" },
];

const SOUND_TAB_INDEX = { speed: 1, sleep: 2 } as const;

async function shootSoundTab(live: NuvoSession, tab: keyof typeof SOUND_TAB_INDEX, looks: Look[], size: Size, open: () => Promise<void>, state: string = tab) {
  await live.shoot(STEP, "panel", state, {
    looks,
    sizes: [size],
    prepare: async () => {
      await open();
      await live.page.locator('[role="dialog"] [role="tab"]').nth(SOUND_TAB_INDEX[tab]).click();
    },
  });
}

function clippedChips(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"] button[aria-pressed], [role="dialog"] [role="tab"]')]
      .filter((chip) => {
        const box = chip.getBoundingClientRect();
        return chip.scrollWidth > chip.clientWidth || box.left < panel.left || box.right > panel.right;
      })
      .map((chip) => chip.textContent ?? "");
  });
}

function sleepChipRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')].slice(0, 5);
    return new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top))).size;
  });
}

async function setCurrentTrack(live: NuvoSession, index: number, context?: string): Promise<void> {
  const page = live.page;
  // a pending debounced store write would land after ours and replace it
  await page.waitForTimeout(1_100);
  await page.evaluate(
    ([at, playbackContext, key]) => {
      const stored = JSON.parse(localStorage.getItem(key)!);
      stored.index = at;
      if (playbackContext) stored.context = playbackContext;
      localStorage.setItem(key, JSON.stringify(stored));
    },
    [index, context, PLAYER_SESSION_KEY] as const,
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.locator('button[aria-label="Open lyrics"], button[aria-label="Открыть текст песни"]').waitFor({ timeout: 15_000 });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

async function measureIsland(page: Page) {
  await page.locator('button[aria-label="Open lyrics"], button[aria-label="Открыть текст песни"]').first().waitFor({ timeout: 15_000 });
  return page.evaluate(() => {
    const box = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const open = document.querySelector('button[aria-label="Open lyrics"], button[aria-label="Открыть текст песни"]')!;
    const island = open.closest("[data-island]")!;
    const probe = document.createElement("span");
    probe.style.color = "var(--n-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const accentUses = [island, ...island.querySelectorAll("*")].flatMap((element) => {
      const style = getComputedStyle(element);
      const used = [style.color, style.backgroundColor, style.borderTopColor, style.fill, style.stroke].includes(accent);
      return used ? [element.outerHTML.slice(0, 80)] : [];
    });
    // tooltips wrap each button in a box-less span, so the buttons are measured directly
    const [previous, play] = island.children[1].querySelectorAll("button");
    return {
      island: box(island),
      background: getComputedStyle(island).backgroundColor,
      backdrop: getComputedStyle(island).backdropFilter,
      lit: island.hasAttribute("data-lit"),
      cover: box(open.firstElementChild!),
      title: box(open.querySelector("[data-island-title]")!),
      titleClipped: (() => {
        const title = open.querySelector("[data-island-title]")!;
        return title.scrollWidth > title.clientWidth;
      })(),
      previous: box(previous),
      play: box(play),
      like: box(island.querySelector("button[data-like], [data-like] button")!),
      centre: box(island.children[1].firstElementChild!),
      actions: box(island.children[2].querySelector("button")!),
      accentUses,
      view: { width: innerWidth, height: innerHeight },
    };
  });
}

async function checkIsland(live: NuvoSession, where: string): Promise<void> {
  for (const size of SIZES) {
    await live.setSize(size);
    await live.page.waitForTimeout(400);
    const m = await measureIsland(live.page);
    const at = `${where} ${size.width}`;
    expect(m.island.height, `${at}: island height`).toBeCloseTo(ISLAND.height, 0);
    expect(m.view.height - m.island.bottom, `${at}: bottom gap`).toBeCloseTo(ISLAND.bottom, 0);
    expect(m.island.width, `${at}: island width`).toBeCloseTo(islandWidth(m.view.width), 0);
    expect(m.island.x, `${at}: on the window's left inset`).toBeCloseTo(ISLAND.left, 0);
    expect(m.cover.width, `${at}: cover width`).toBeCloseTo(ISLAND.cover, 0);
    expect(m.cover.height, `${at}: cover height`).toBeCloseTo(ISLAND.cover, 0);
    expect(m.cover.x - m.island.x, `${at}: cover inset`).toBeCloseTo(ISLAND.coverInset, 0);
    expect(m.play.width, `${at}: play width`).toBeCloseTo(ISLAND.play, 0);
    expect(m.play.height, `${at}: play height`).toBeCloseTo(ISLAND.play, 0);
    expect(m.background, `${at}: never black`).not.toBe("rgb(0, 0, 0)");
    if (m.lit) expect(m.backdrop, `${at}: frosted glass`).toContain("blur");
    expect(m.accentUses, `${at}: no accent inside the island`).toEqual([]);
    expect(m.like.right, `${at}: like ends before the middle`).toBeLessThan(m.centre.x);
    expect(m.centre.right, `${at}: the middle ends before the panel buttons`).toBeLessThan(m.actions.x);
  }
}

async function installLinkFixtures(page: Page): Promise<void> {
  const next = nextResponse(
    queueRow({
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      byline: [artistRun("Rick Astley", "UCuAXFkgsw1L7xaCfnd5JJOw"), SEP, run("Whenever You Need Somebody")],
      length: "3:30",
      selected: true,
    }),
  );
  const soundcloud = {
    items: [{ type: "track", id: "sc-1", title: "Midnight City", artists: [{ id: "sc-a", name: "M83" }], durationMs: 241_000 }],
  };
  await page.evaluate(
    ({ next, soundcloud }) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      const real = window.fetch.bind(window);
      if ((window as { linkFixtures?: boolean }).linkFixtures) return;
      (window as { linkFixtures?: boolean }).linkFixtures = true;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/youtubei/v1/next")) return json(next);
        if (url.startsWith("nuvo-core://local/v1/sc/lookup")) return json(soundcloud);
        if (url.startsWith("nuvo-core://local/v1/links/inspect")) return json({ error: "unsupported" });
        if (/(^|\.)(youtube|ytimg|googlevideo|soundcloud)\.com$/.test(new URL(url).hostname)) return new Response("", { status: 404 });
        return real(input, init);
      };
    },
    { next, soundcloud },
  );
}

async function pasteLink(page: Page, link: string): Promise<void> {
  await page.keyboard.press("Control+A");
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, link);
  await page.keyboard.insertText(link);
}

const LINK_CASES = [
  // the durations are the fixtures' own (live answers differ), so a request that slipped past them fails the step
  { name: "youtube", link: "https://youtu.be/dQw4w9WgXcQ", en: "3:30", ru: "3:30" },
  { name: "soundcloud", link: "https://soundcloud.com/m83/midnight-city", en: "4:01", ru: "4:01" },
  {
    name: "unsupported",
    link: "https://www.example.org/clips/42",
    en: "Nuvo can't read links from www.example.org yet.",
    ru: "Nuvo пока не читает ссылки с www.example.org.",
  },
] as const;

describe("shell", () => {
  it("frames home, library and a playlist with the top bar in every look", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    const page = live.page;
    const screens: [string, string][] = [
      ["home", "#/"],
      ["library", "#/library"],
      ["playlist", `#/library/playlist?id=${live.seed!.bigPlaylistId}`],
    ];
    for (const [screen, hash] of screens) {
      await live.go(hash);
      const files = await live.shoot(STEP, screen, "seeded");
      expect(files).toHaveLength(12);
    }

    await live.go("#/");
    await checkGeometry(live, "home");
    expect(await page.locator("aside nav").count()).toBe(0);
    expect(await page.locator('header img[alt="Nuvo"]').count()).toBe(0);

    await page.locator('header nav a[data-nav="library"]').click();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => location.hash)).toBe("#/library");
    expect(await page.locator('header nav a[aria-current="page"]').getAttribute("aria-label")).toBe("Library");
    for (const hash of ["#/library", "#/recognize", "#/stats", "#/search"]) {
      await live.go(hash);
      const top = await page.evaluate(() => document.querySelector(".n-scroll h1, .n-scroll input")!.getBoundingClientRect().top);
      expect(top, `${hash}: the page starts below the bar`).toBeGreaterThanOrEqual(TOP_BAR.height);
    }

    expect(await page.getByRole("button", { name: "Back", exact: true }).count()).toBe(0);
    await live.go(`#/library/playlist?id=${live.seed!.bigPlaylistId}`);
    expect(await page.getByRole("button", { name: "Back", exact: true }).count()).toBe(1);
  }, 900_000);

  it("opens the Search page by its route, and the search shortcut opens the palette", async () => {
    const live = session ?? (session = await launchNuvo({ profile: "seeded" }));
    const page = live.page;
    const fieldFocused = () => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.placeholder === "Songs, albums, artists");
    const fromRail = async () => {
      await live.go("#/");
      await live.go("#/search");
      await page.getByPlaceholder("Songs, albums, artists").waitFor({ timeout: 5_000 });
    };
    await fromRail();
    expect(await page.evaluate(() => location.hash)).toBe("#/search");
    expect(await fieldFocused()).toBe(true);

    await page.route(/youtubei\/v1\/search/, () => undefined);
    await page.getByPlaceholder("Songs, albums, artists").fill("radiohead");
    await page.locator("[data-placeholder=row]").waitFor({ timeout: 5_000 });
    expect(await page.locator("[data-placeholder=row] > *").count()).toBe(5);
    await page.unroute(/youtubei\/v1\/search/);
    await page.getByPlaceholder("Songs, albums, artists").fill("");

    await live.go("#/library");
    await page.waitForTimeout(500);
    await page.keyboard.press("/");
    await page.locator('[role="dialog"][data-state="in"]').waitFor({ timeout: 5_000 });
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("combobox");
    expect(await page.evaluate(() => location.hash)).toBe("#/library");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await live.go("#/search");

    await page.getByPlaceholder("Songs, albums, artists").fill("a");
    await live.shoot(STEP, "search", "page", {
      looks: [
        { preset: "nuvo", mode: "light" },
        { preset: "nuvo", mode: "dark" },
      ],
      prepare: fromRail,
    });

    await page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await live.setLook({ preset: "nuvo", mode: "light" });
    await live.setSize(SIZES[1]);
    await live.go("#/search?q=a");
    await page.locator('[role="tablist"]').first().waitFor({ timeout: 10_000 });
    const overflow = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]')!;
      return list.scrollWidth - list.clientWidth;
    });
    await live.shoot(STEP, "search", "ru", { looks: [{ preset: "nuvo", mode: "light" }], sizes: [SIZES[1]] });
    await page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    expect(overflow, "Russian tabs fit at 1100").toBeLessThanOrEqual(0);
  }, 300_000);

  it("opens a pasted link as one block in place of the tabs and groups", async () => {
    const live = session ?? (session = await launchNuvo({ profile: "seeded" }));
    const page = live.page;
    await page.route(/^https?:\/\/([a-z0-9-]+\.)*(youtube|ytimg|googlevideo|soundcloud|sndcdn)\.com\//, (route) => route.fulfill({ status: 404 }));
    const shots: string[] = [];
    for (const locale of ["en", "ru"] as const) {
      await page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      for (const item of LINK_CASES) {
        const prepare = async () => {
          // fixtures first: search reopens a link it held a minute ago as soon as it mounts
          await installLinkFixtures(page);
          await live.go("#/library");
          await live.go("#/search");
          await pasteLink(page, item.link);
          await page.getByText(item[locale]).first().waitFor({ timeout: 15_000 });
        };
        const looks: Look[] = locale === "en" ? NUVO_LOOKS : [NUVO_LOOKS[0]];
        const sizes = locale === "en" ? SIZES : [SIZES[1]];
        shots.push(...(await live.shoot(STEP, "search-link", `${item.name}-${locale}`, { looks, sizes, prepare })));
        for (const size of sizes) {
          await live.setSize(size);
          const layout = await page.evaluate(() => {
            const block = document.querySelector("section[aria-busy]")!.getBoundingClientRect();
            const field = document.querySelector("input:not([role=combobox])")!.closest("div")!.getBoundingClientRect();
            return {
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              tabs: document.querySelectorAll('[role="tablist"]').length,
              blockLeft: block.left,
              fieldLeft: field.left,
              blockRight: block.right,
              fieldRight: field.right,
              busy: document.querySelector("section[aria-busy]")!.getAttribute("aria-busy"),
            };
          });
          const at = `${item.name} ${locale} ${size.width}`;
          expect(layout.tabs, `${at}: no tabs while a link is shown`).toBe(0);
          expect(layout.busy, `${at}: the job finished`).toBe("false");
          expect(layout.overflow, `${at}: no horizontal overflow`).toBeLessThanOrEqual(0);
          expect(layout.blockLeft, `${at}: block starts on the field's edge`).toBeGreaterThanOrEqual(layout.fieldLeft - 1);
          expect(layout.blockRight, `${at}: block stays inside the field's width`).toBeLessThanOrEqual(layout.fieldRight + 1);
        }
      }
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await page.locator("section[aria-busy]").count()).toBe(0);
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>("input:not([role=combobox])")!.value)).toBe("");
    expect(await page.getByText("example.org").count()).toBe(0);

    await page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    expect(shots).toHaveLength(LINK_CASES.length * 5);
  }, 600_000);

  it("shows the island with the paused track in every look and size", async () => {
    const live = session!;
    await live.go("#/");
    await setCurrentTrack(live, 0);
    const files = await live.shoot(STEP, "home", "island");
    expect(files).toHaveLength(12);
    await live.setLook({ preset: "nuvo", mode: "light" });
    await checkIsland(live, "island");
  }, 900_000);

  it("opens each island popover 10 px above the player", async () => {
    const live = session!;
    const page = live.page;
    const popovers: [string, string][] = [
      ["island-volume", "Volume"],
      ["island-sound", "Sound"],
      ["island-add", "Add to playlist"],
    ];
    for (const [screen, name] of popovers) {
      const button = page.locator(`button[aria-label="${name}"]`);
      const open = async () => {
        await button.waitFor({ timeout: 15_000 });
        if ((await page.locator('[role="dialog"]').count()) === 0) await button.click();
        await page.locator('[role="dialog"]').waitFor({ timeout: 5_000 });
      };
      await live.shoot(STEP, screen, "open", { looks: NUVO_LOOKS, prepare: open });
      await page.waitForTimeout(400);
      const gap = await page.evaluate((label) => {
        const bar = document.querySelector(`button[aria-label="${label}"]`)!.closest("[data-island]")!.getBoundingClientRect();
        const panel = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
        return bar.top - panel.bottom;
      }, name);
      expect(gap, `${screen}: gap above the player`).toBeCloseTo(POPOVER.islandGap, 0);
      expect(await page.locator('[role="dialog"]').getAttribute("aria-label")).toBe(name);
      const glass = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')!;
        const blurred = (element: Element) => getComputedStyle(element).backdropFilter !== "none";
        return { panel: blurred(dialog), inside: [...dialog.querySelectorAll("*")].filter(blurred).length };
      });
      expect(glass, `${screen}: glass with one backdrop layer`).toEqual({ panel: true, inside: 0 });
      if (screen === "island-sound") {
        await shootSoundTab(live, "speed", NUVO_LOOKS, SIZES[0], open);
        await shootSoundTab(live, "sleep", NUVO_LOOKS, SIZES[0], open);
        expect(await sleepChipRows(page), "sleep: the five lengths keep one row").toBe(1);
        await live.setSize(SIZES[1]);
        await open();
        await page.locator('[role="dialog"] [role="tab"]').first().click();
        await page.waitForTimeout(400);
        expect(await clippedChips(page), "equalizer presets at 1100 px").toEqual([]);
        for (const tab of [1, 2, 3]) {
          await page.locator('[role="dialog"] [role="tab"]').nth(tab).click();
          await page.waitForTimeout(400);
          expect(await clippedChips(page), `sound tab ${tab}: the tabs and chips fit`).toEqual([]);
        }
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    await live.setSize(SIZES[0]);
    const bar = await page.locator("[data-island]").boundingBox();
    await page.mouse.click(bar!.x + bar!.width * 0.75, bar!.y + 6);
    await page.waitForTimeout(400);
    const played = await page.evaluate(() => {
      const fill = document.querySelector<HTMLElement>('[role="slider"][aria-label="Position"] > span')!;
      return parseFloat(fill.style.transform.replace("translateX(", "")) + 100;
    });
    expect(played, "seek on the bar").toBeGreaterThan(60);
    await page.mouse.move(10, 300);

    const queue = page.locator('button[aria-label="Queue"]');
    const openQueue = async () => {
      if ((await queue.getAttribute("aria-pressed")) !== "true") await queue.click();
    };
    await live.shoot(STEP, "island-queue", "open", { looks: [{ preset: "nuvo", mode: "dark" }], sizes: [SIZES[1]], prepare: openQueue });
    const m = await measureIsland(page);
    expect(m.island.width, "queue open: width").toBeCloseTo(islandWidth(m.view.width), 0);
    expect(m.island.x, "queue open: on the left inset").toBeCloseTo(ISLAND.left, 0);
    await page.locator('button[aria-label="Queue"]').click();
    await page.waitForTimeout(400);
  }, 900_000);

  it("says radio in the island's state line", async () => {
    const live = session!;
    const page = live.page;
    await live.go("#/");
    await setCurrentTrack(live, 0, "radio:seed-0001");
    const line = page.locator("[data-state-line]");
    await live.shoot(STEP, "island-state", "radio", { looks: NUVO_LOOKS, sizes: [SIZES[0]], prepare: () => line.waitFor({ timeout: 10_000 }) });
    expect(await line.textContent()).toMatch(/^(Radio · from .+|Offline)$/);
    const fit = await page.evaluate(() => {
      const title = document.querySelector("[data-island-title]")!;
      const island = title.closest("[data-island]")!.getBoundingClientRect();
      const inside = (element: Element) => {
        const box = element.getBoundingClientRect();
        return box.top >= island.top && box.bottom <= island.bottom;
      };
      return { title: inside(title), line: inside(document.querySelector("[data-state-line]")!) };
    });
    expect(fit, "state line: title and line stay inside the bar").toEqual({ title: true, line: true });

    await live.setLook({ preset: "nuvo", mode: "light" });
    await setCurrentTrack(live, 0, "Late night drive");
  }, 600_000);

  it("opens the search palette under the field on Ctrl+K: suggestions, a match, nothing, a settings entry and full screen", async () => {
    const live = session ?? (session = await launchNuvo({ profile: "seeded" }));
    const page = live.page;
    // the catalogue never answers here, so every row the checks read comes from the library and the commands
    await page.route(/youtubei\/v1\/search/, (route) => route.abort());
    const palette = page.locator('[role="dialog"][data-state="in"]');
    const field = page.locator("header input[role=combobox]");
    const option = (text: string) => palette.locator('[role="option"]', { hasText: text }).first();
    const openWith = (query: string) => async () => {
      if ((await palette.count()) === 0) await page.keyboard.press("Control+KeyK");
      await palette.waitFor({ timeout: 5_000 });
      await field.fill(query);
      await page.waitForTimeout(400);
    };
    await live.go("#/library");
    const at1200 = { looks: NUVO_LOOKS, sizes: [SIZES[0]] };
    await live.shoot(STEP, "palette", "empty", { ...at1200, prepare: openWith("") });
    await live.shoot(STEP, "palette", "empty", { looks: [{ preset: "amber", mode: "dark" }], prepare: openWith("") });
    await live.shoot(STEP, "palette", "rep", { ...at1200, prepare: openWith("rep") });
    await live.shoot(STEP, "palette", "zzz", { ...at1200, prepare: openWith("zzz") });
    await live.setLook({ preset: "nuvo", mode: "light" });

    await openWith("")();
    const box = (await palette.boundingBox())!;
    const under = (await field.locator("..").boundingBox())!;
    expect(box.y, "palette: 8 px under the field").toBeCloseTo(under.y + under.height + 8, 0);
    expect(box.width, "palette: 640 wide").toBeCloseTo(640, 0);
    expect(box.x + box.width / 2, "palette: centred on the field").toBeCloseTo(under.x + under.width / 2, 0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role")), "palette: typing goes to the field").toBe("combobox");
    expect(await palette.locator('[role="option"]').count(), "palette: five suggestions").toBe(5);
    await field.fill("rep");
    await option("Change repeat").waitFor({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    expect(await palette.count(), "palette: Escape closes").toBe(0);
    expect(await field.inputValue(), "palette: Escape clears the field").toBe("");
    expect(await page.evaluate(() => location.hash), "palette: Escape stays on the page").toBe("#/library");

    await openWith("cover glow")();
    await page.keyboard.press("Enter");
    await page.getByText("Cover glow", { exact: true }).first().waitFor({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const fullScreen = () =>
      live.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().includes("#/notch"))!
          .isFullScreen(),
      );
    // the window manager answers in its own time: wait for the window's state, not a fixed delay
    await openWith("full screen")();
    await option("Toggle full screen").waitFor({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect.poll(fullScreen, { message: "palette: full screen on", timeout: 10_000 }).toBe(true);
    await openWith("full screen")();
    await option("Toggle full screen").waitFor({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect.poll(fullScreen, { message: "palette: full screen off", timeout: 10_000 }).toBe(false);

    await page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
    const ru = { looks: [{ preset: "nuvo", mode: "light" } as Look], sizes: [SIZES[0]] };
    await live.shoot(STEP, "palette", "ru-empty", { ...ru, prepare: openWith("") });
    await live.shoot(STEP, "palette", "ru-shuffle", { ...ru, prepare: openWith("перем") });
    const clipped = await palette.evaluate(
      (panel) => [...panel.querySelectorAll('[role="option"] > span:first-child')].filter((title) => title.scrollWidth > title.clientWidth).length,
    );
    expect(clipped, "palette: no Russian title clipped").toBe(0);
    await openWith("повт")();
    await option("Сменить режим повтора").waitFor({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.unroute(/youtubei\/v1\/search/);
    await page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  }, 600_000);

  it("fits the Russian navigation at the minimum size", async () => {
    const live = session!;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await live.go("#/");
    await live.shoot(STEP, "home", "ru", { looks: [{ preset: "nuvo", mode: "light" }], sizes: [SIZES[1]] });
    await checkGeometry(live, "ru home");
    expect(await live.page.locator("header nav a[data-nav]").first().getAttribute("aria-label")).toBe("Главная");

    const sound = live.page.locator("[data-island] button[aria-haspopup]").first();
    const openSound = async () => {
      if ((await live.page.locator('[role="dialog"]').count()) === 0) await sound.click();
      await live.page.locator('[role="dialog"]').waitFor({ timeout: 5_000 });
    };
    await shootSoundTab(live, "sleep", [{ preset: "nuvo", mode: "light" }], SIZES[1], openSound, "sleep-ru");
    expect(await sleepChipRows(live.page), "ru sleep: the five lengths keep one row").toBe(1);
    await live.page.locator('[role="dialog"] [role="tab"]').first().click();
    await live.page.waitForTimeout(400);
    expect(await clippedChips(live.page), "ru equalizer presets at 1100 px").toEqual([]);
    for (const tab of [1, 2, 3]) {
      await live.page.locator('[role="dialog"] [role="tab"]').nth(tab).click();
      await live.page.waitForTimeout(400);
      expect(await clippedChips(live.page), `ru sound tab ${tab}: the tabs and chips fit`).toEqual([]);
    }
    await live.page.keyboard.press("Escape");
    await live.page.waitForTimeout(300);

    await setCurrentTrack(live, 2);
    await live.shoot(STEP, "home", "ru-long", { looks: [{ preset: "nuvo", mode: "light" }], sizes: [SIZES[1]] });
    const m = await measureIsland(live.page);
    expect(m.titleClipped, "ru-long: the title ellipsizes").toBe(true);
    expect(m.title.right, "ru-long: the title ends before the previous button").toBeLessThan(m.previous.x);
    expect(m.like.right, "ru-long: like ends before the middle").toBeLessThan(m.centre.x);
  }, 600_000);
});
