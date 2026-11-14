import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type Look, type NuvoSession, type Size } from "./harness";
import { PLAYER_SESSION_KEY } from "./seed";

const SHOTS = process.env.TOUR_SHOTS ?? path.join(os.homedir(), ".cache", "tour-shots");
const TOUR_KEY = "nuvo_tour_v1";

interface Run {
  name: string;
  locale: "en" | "ru";
  look: Look;
  size: Size;
}

const RUNS: Run[] = [
  { name: "en-dark-1200", locale: "en", look: { preset: "nuvo", mode: "dark" }, size: { width: 1200, height: 780 } },
  { name: "ru-light-1100", locale: "ru", look: { preset: "nuvo", mode: "light" }, size: { width: 1100, height: 705 } },
];

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "");

function shotDir(run: string): string {
  const dir = path.join(SHOTS, run);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function shot(page: Page, dir: string, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function checkLayout(page: Page, where: string): Promise<void> {
  const boxes = await page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.left, y: box.top, right: box.right, bottom: box.bottom };
    };
    const layer = document.querySelector("[data-tour-layer]")!;
    const hole = layer.children[1];
    return {
      view: { width: innerWidth, height: innerHeight },
      callout: rect(layer.querySelector("[data-callout]")),
      dock: rect(layer.querySelector("[data-dock]")),
      hole: rect(hole),
    };
  });
  const overlap = (a: typeof boxes.hole, b: typeof boxes.hole) => !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  expect(overlap(boxes.callout, boxes.dock), `${where}: callout over the dock`).toBe(false);
  expect(overlap(boxes.callout, boxes.hole), `${where}: callout over the outline`).toBe(false);
  expect(overlap(boxes.dock, boxes.hole), `${where}: dock over the outline`).toBe(false);
  for (const box of [boxes.callout, boxes.dock]) {
    if (!box) continue;
    expect(box.x, `${where}: off the left edge`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${where}: off the top edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${where}: off the right edge`).toBeLessThanOrEqual(boxes.view.width);
    expect(box.bottom, `${where}: off the bottom edge`).toBeLessThanOrEqual(boxes.view.height);
  }
}

async function walk(page: Page, dir: string, onStep?: (key: string, index: number) => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  let previous = "";
  for (;;) {
    const handle = await page.waitForFunction(
      (prev) => {
        const layer = document.querySelector("[data-tour-layer]");
        if (!layer || !layer.querySelector("[data-next]")) return "end";
        const key = layer.querySelector("[aria-live]")?.textContent ?? "";
        return key && key !== prev && layer.querySelector("[data-callout]") ? key : null;
      },
      previous,
      { timeout: 30_000, polling: 150 },
    );
    const key = (await handle.jsonValue()) as string;
    if (key === "end") break;
    previous = key;
    seen.push(key);
    const name = `${String(seen.length + 10).padStart(2, "0")}-${slug(key.split(". ")[0])}-${seen.length}`;
    await shot(page, dir, name);
    await checkLayout(page, name);
    await onStep?.(key, seen.length);
    await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 15_000 });
  }
  return seen;
}

async function saved(page: Page): Promise<{ status: string; at: unknown; missed: string[] }> {
  await page.waitForTimeout(1_200);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").state, TOUR_KEY);
}

async function relaunchWith(page: Page, entries: Record<string, (stored: unknown) => unknown>): Promise<void> {
  // a pending debounced store write would land after ours and replace it
  await page.waitForTimeout(1_100);
  for (const [key, change] of Object.entries(entries)) {
    const current = await page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);
    const next = change(current);
    await page.evaluate(([name, value]) => localStorage.setItem(name, value), [key, JSON.stringify(next)] as const);
  }
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

const tourAt = (chapter: string | null) => () => ({ state: { status: "on", at: chapter ? { chapter, step: 0 } : null, missed: [] }, version: 0 });

describe("tour", () => {
  it("fresh profile: the phrase, the start step, then every chapter the empty window can show", async () => {
    session = await launchNuvo({ profile: "fresh" });
    const page = session.page;
    const dir = shotDir("fresh-en-light-1200");
    await session.setLook({ preset: "nuvo", mode: "light" });
    await session.setSize({ width: 1200, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "I wrote it down" }).click();
    await page.locator("#tour-start-title").waitFor({ timeout: 30_000 });
    await expect.poll(() => backdropRoots(page, "[aria-labelledby=tour-start-title]")).toEqual([]);
    await shot(page, dir, "00-start");

    const field = page.getByRole("textbox", { name: "Song or artist" });
    let picked = 0;
    for (const name of ["Teardrop", "Massive Attack", "Portishead"]) {
      await field.fill(name);
      const first = page.locator('[aria-label="Suggestions"] button').first();
      const found = await first.waitFor({ timeout: 8_000 }).then(
        () => true,
        () => false,
      );
      if (name === "Teardrop") await shot(page, dir, "01-start-suggestions");
      if (!found) break;
      await first.click();
      picked += 1;
    }
    expect(await page.locator("[data-seed]").count(), "every pick shows as a seed").toBe(picked);
    await field.fill("");
    await shot(page, dir, "02-start-picks");
    const use = page.getByRole("button", { name: "Use these" });
    if (await use.isEnabled()) {
      await use.click();
      await page.getByText("Home will start from these.").waitFor();
      await shot(page, dir, "03-start-sent");
    }

    await page.locator("[data-primary]").click();
    const counters: string[] = [];
    const seen = await walk(page, dir, async (key, index) => {
      const counter = await page.locator("[data-dock] [class*=counter]").textContent();
      if (counter && counters.at(-1) !== counter) counters.push(counter);
      // search is the top bar field and the Ctrl K palette, never a page of its own
      if (index === 2) expect(await page.locator('[role="dialog"]:has(> [role="listbox"])').count()).toBe(1);
      expect(await page.evaluate(() => location.hash)).not.toContain("search");
      if (!key.includes("Pick a theme")) return;
      await page.locator('[data-preset="dusk"]').click();
      await page.waitForFunction(() => document.documentElement.dataset.preset === "dusk");
      await shot(page, dir, "40-theme-picked");
      await page.locator('[data-preset="nuvo"]').click();
    });

    const chapters = [...new Set(seen.map((key) => key.split(". ")[0]))];
    expect(chapters).toEqual(["Search", "Recognize", "Player", "Sound", "Playlists", "Library", "Home", "Look"]);
    expect(counters).toEqual(chapters.map((_, index) => `${index + 1} of 8`));
    await page.locator("[data-tour-layer]").waitFor({ state: "detached" });
    const state = await saved(page);
    expect(state.status).toBe("done");
    expect(state.missed).toEqual([]);
    await expect.poll(() => page.locator("[data-island]").count()).toBe(0);
    await session.close();
    session = null;
  }, 300_000);

  for (const run of RUNS) {
    it(`seeded profile with a track: the whole tour, the prompt and the short version (${run.name})`, async () => {
      session = await launchNuvo({ profile: "seeded" });
      const page = session.page;
      const dir = shotDir(`seeded-${run.name}`);
      await session.setLook(run.look);
      await session.setSize(run.size);
      await page.emulateMedia({ reducedMotion: "reduce" });

      await page.evaluate((locale) => localStorage.setItem("nuvo_locale", locale), run.locale);
      await relaunchWith(page, {
        [PLAYER_SESSION_KEY]: (stored) => ({ ...(stored as object), index: 0 }),
        [TOUR_KEY]: tourAt("search"),
      });
      await page.locator("[data-island]").waitFor({ timeout: 30_000 });
      await page.locator("[data-tour-layer] [data-primary]").waitFor({ timeout: 30_000 });
      await shot(page, dir, "00-resume");
      await page.locator("[data-tour-layer] [data-primary]").click();
      const seen = await walk(page, dir);
      expect(seen.length).toBeGreaterThanOrEqual(11);
      const locale = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", "i18n", "locales", `${run.locale}.json`), "utf8"));
      const steps = locale.ui.tour.steps as Record<string, string>;
      for (const step of ["search_bar", "palette", "lyrics", "rate", "speed", "sleep", "nav_recognize", "recognize_sources"])
        expect(
          seen.some((key) => key.includes(steps[step])),
          `${run.name}: the ${step} step`,
        ).toBe(true);
      expect((await saved(page)).status).toBe("done");

      await relaunchWith(page, { [TOUR_KEY]: tourAt(null) });
      await page.locator("#tour-start-title").waitFor({ timeout: 30_000 });
      await shot(page, dir, "01-start");
      await page.locator("[data-primary]").click();
      await page.locator("[data-callout]").waitFor({ timeout: 30_000 });
      await page.keyboard.press("Escape");
      await page.locator("[data-prompt]").waitFor();
      await shot(page, dir, "90-prompt");
      await page.locator("[data-prompt] button").nth(2).click();
      await page.locator("#tour-brief-title").waitFor();
      await shot(page, dir, "91-brief");
      await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 15_000 });
      await page.locator("[data-tour-layer]").waitFor({ state: "detached" });
      expect((await saved(page)).status).toBe("done");
      await session.close();
      session = null;
    }, 300_000);
  }
});

async function backdropRoots(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((card) => {
    const found: string[] = [];
    for (let el = card.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      const animated = el
        .getAnimations()
        .flatMap((animation) => (animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []))
        .some((frame) => "opacity" in frame || "filter" in frame);
      const set =
        style.opacity !== "1" ||
        style.filter !== "none" ||
        style.backdropFilter !== "none" ||
        style.maskImage !== "none" ||
        style.clipPath !== "none" ||
        style.mixBlendMode !== "normal" ||
        /opacity|filter|mask|clip/.test(style.willChange);
      if (animated || set) found.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    return found;
  });
}
