import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { launchNuvo, type NuvoSession, type Size } from "./harness";
import { PLAYER_SESSION_KEY } from "./seed";

const SHOTS = process.env.TOUR_SHOTS ?? path.join(os.homedir(), ".cache", "tour-geometry");
const TOUR_KEY = "nuvo_tour_v1";
const STEPS = 18;

type Fit = Size | "maximized";

interface Display {
  scale: number;
  fits: Fit[];
}

// The 4K monitor of the headless session is 3840x2160, so a maximized window is 3840, 2560 or 1920 CSS pixels wide
const DISPLAYS: Display[] = [
  { scale: 1, fits: [{ width: 1100, height: 705 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, "maximized"] },
  { scale: 1.5, fits: ["maximized"] },
  { scale: 2, fits: ["maximized"] },
];

// Mirrors src/ui/tour/targets.ts: the e2e page cannot import app modules
const TARGETS: Record<string, string> = {
  island: "[data-island]",
  "search-bar": "header [role=combobox] ..",
  palette: '[role="dialog"]:has(> [role="listbox"])',
  "nav-recognize": '[data-nav="recognize"]',
  scrubber: '[data-island] [role="slider"]',
  rate: "[data-island] span:has([data-like]):has([data-dislike])",
  lyrics: "[data-island] button:has([data-island-title])",
  queue: '[data-tour="queue"]',
  "sound-panel": '[role="dialog"]:not([aria-modal]):has([role="tab"])',
  "add-button": '[data-tour="add"]',
};

interface Rect {
  x: number;
  y: number;
  right: number;
  bottom: number;
}

interface Geometry {
  view: { width: number; height: number };
  target: string;
  seen: Rect | null;
  hole: Rect | null;
  callout: Rect | null;
  dock: Rect | null;
  covered: string[];
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate((targets) => {
    const rect = (box: DOMRect): Rect => ({ x: box.left, y: box.top, right: box.right, bottom: box.bottom });
    const layer = document.querySelector("[data-tour-layer]")!;
    const holeElement = layer.querySelector<HTMLElement>("[data-hole]")!;
    const target = holeElement.dataset.target ?? "";
    const selector = (targets as Record<string, string>)[target] ?? `[data-tour="${target}"]`;
    const element = selector.endsWith(" ..") ? document.querySelector(selector.slice(0, -3))?.parentElement : document.querySelector(selector);
    let seen: Rect | null = null;
    if (element) {
      seen = rect(element.getBoundingClientRect());
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const clip = rect(parent.getBoundingClientRect());
        seen = {
          x: Math.max(seen.x, clip.x),
          y: Math.max(seen.y, clip.y),
          right: Math.min(seen.right, clip.right),
          bottom: Math.min(seen.bottom, clip.bottom),
        };
      }
      seen = { x: Math.max(seen.x, 0), y: Math.max(seen.y, 0), right: Math.min(seen.right, innerWidth), bottom: Math.min(seen.bottom, innerHeight) };
      if (seen.right <= seen.x || seen.bottom <= seen.y) seen = null;
    }
    const calloutElement = layer.querySelector("[data-callout]");
    const callout = calloutElement ? rect(calloutElement.getBoundingClientRect()) : null;
    const panel = element?.closest('[role="dialog"]');
    const covered: string[] = [];
    if (callout && panel) {
      for (const control of panel.querySelectorAll<HTMLElement>("button, input, select, textarea, [role=slider], [role=switch]")) {
        if (element?.contains(control)) continue;
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const hit = elementsUnder(box);
        if (!hit.includes(control)) continue;
        if (box.left < callout.right && callout.x < box.right && box.top < callout.bottom && callout.y < box.bottom)
          covered.push(control.textContent?.trim() || control.getAttribute("aria-label") || control.tagName);
      }
    }
    function elementsUnder(box: DOMRect): Element[] {
      const x = Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1);
      layer.setAttribute("style", "visibility: hidden");
      const found = document.elementsFromPoint(x, y);
      layer.removeAttribute("style");
      return found;
    }
    return {
      view: { width: innerWidth, height: innerHeight },
      target,
      seen,
      hole: holeElement.hasAttribute("data-empty") ? null : rect(holeElement.getBoundingClientRect()),
      callout,
      dock: layer.querySelector("[data-dock]") ? rect(layer.querySelector("[data-dock]")!.getBoundingClientRect()) : null,
      covered,
    };
  }, TARGETS);
}

const overlap = (a: Rect | null, b: Rect | null) => !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

function check(found: Geometry, where: string, tip = true): void {
  const at = `${where} (${found.target})`;
  expect.soft(found.seen, `${at}: the target is not on screen`).not.toBeNull();
  expect.soft(found.hole, `${at}: no outline`).not.toBeNull();
  if (!found.seen || !found.hole) return;
  const seen = found.seen;
  const hole = found.hole;
  // The outline wraps what is visible of the target with a small pad and never spills past the clip that hides the rest
  expect.soft(hole.x, `${at}: outline left`).toBeLessThanOrEqual(seen.x + 1);
  expect.soft(hole.y, `${at}: outline top`).toBeLessThanOrEqual(seen.y + 1);
  expect.soft(hole.right, `${at}: outline right`).toBeGreaterThanOrEqual(seen.right - 1);
  expect.soft(hole.bottom, `${at}: outline bottom`).toBeGreaterThanOrEqual(seen.bottom - 1);
  expect.soft(seen.x - hole.x, `${at}: outline spills left`).toBeLessThanOrEqual(8);
  expect.soft(seen.y - hole.y, `${at}: outline spills up`).toBeLessThanOrEqual(8);
  expect.soft(hole.right - seen.right, `${at}: outline spills right`).toBeLessThanOrEqual(8);
  expect.soft(hole.bottom - seen.bottom, `${at}: outline spills down`).toBeLessThanOrEqual(8);
  if (tip) expect.soft(found.callout, `${at}: no tip`).not.toBeNull();
  expect.soft(overlap(found.callout, hole), `${at}: tip over the outline`).toBe(false);
  expect.soft(overlap(found.callout, found.dock), `${at}: tip over the dock`).toBe(false);
  expect.soft(overlap(found.dock, hole), `${at}: dock over the outline`).toBe(false);
  expect.soft(found.covered, `${at}: tip over controls next to the target`).toEqual([]);
  for (const box of [found.callout, found.dock]) {
    if (!box) continue;
    expect.soft(box.x, `${at}: off the left edge`).toBeGreaterThanOrEqual(0);
    expect.soft(box.y, `${at}: off the top edge`).toBeGreaterThanOrEqual(0);
    expect.soft(box.right, `${at}: off the right edge`).toBeLessThanOrEqual(found.view.width);
    expect.soft(box.bottom, `${at}: off the bottom edge`).toBeLessThanOrEqual(found.view.height);
  }
}

async function settled(page: Page): Promise<Geometry> {
  let previous = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(150);
    const found = await geometry(page);
    const key = JSON.stringify(found);
    if (key === previous) return found;
    previous = key;
  }
  return geometry(page);
}

async function fit(session: NuvoSession, size: Fit): Promise<void> {
  if (size !== "maximized") return session.setSize(size);
  // The headless shell ignores maximize, so the window takes the work area a maximized one would
  await session.app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("file:") && !w.webContents.getURL().includes("#/notch"));
    win?.setBounds(screen.getPrimaryDisplay().workArea);
  });
  await session.page.waitForFunction(() => innerWidth >= 1900, undefined, { timeout: 10_000 });
}

const fitName = (size: Fit) => (size === "maximized" ? "max" : `${size.width}x${size.height}`);

async function startTour(page: Page, locale: "en" | "ru"): Promise<void> {
  await page.waitForTimeout(1_100);
  await page.evaluate(
    ([key, tourKey, value]) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...stored, index: 0 }));
      localStorage.setItem(tourKey, JSON.stringify({ state: { status: "on", at: { chapter: "search", step: 0 }, missed: [] }, version: 0 }));
      localStorage.setItem("nuvo_locale", value);
    },
    [PLAYER_SESSION_KEY, TOUR_KEY, locale] as const,
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.locator("[data-island]").waitFor({ timeout: 30_000 });
  await page.locator("[data-tour-layer] [data-primary]").click({ timeout: 30_000 });
}

async function nextStep(page: Page, previous: string): Promise<string> {
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
  return (await handle.jsonValue()) as string;
}

async function next(page: Page): Promise<void> {
  await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 15_000 });
}

async function shoot(page: Page, dir: string, name: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), scale: "css", type: "jpeg", quality: 60 });
}

let session: NuvoSession | null = null;

afterEach(async () => {
  await session?.close();
  session = null;
});

describe("tour geometry", () => {
  for (const display of DISPLAYS) {
    it(`every step at ${display.scale * 100} %`, async () => {
      session = await launchNuvo({ profile: "seeded", args: [`--force-device-scale-factor=${display.scale}`] });
      const page = session.page;
      await session.setLook({ preset: "nuvo", mode: "light" });
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const size of display.fits) {
        for (const locale of ["en", "ru"] as const) {
          const run = `${display.scale * 100}-${fitName(size)}-${locale}`;
          await fit(session, size);
          await startTour(page, locale);
          let key = "";
          let index = 0;
          for (;;) {
            key = await nextStep(page, key);
            if (key === "end") break;
            index += 1;
            const where = `${run} step ${index} "${key}"`;
            const found = await settled(page);
            if (process.env.TOUR_SHOTS) await shoot(page, path.join(SHOTS, run), String(index).padStart(2, "0"));
            check(found, where);
            await next(page);
          }
          expect.soft(index, `${run}: every step shows`).toBe(STEPS);
          await page.locator("[data-tour-layer]").waitFor({ state: "detached" });
        }
      }
    }, 900_000);
  }

  it("the outline follows a resize and a scroll in the middle of a step", async () => {
    session = await launchNuvo({ profile: "seeded" });
    const page = session.page;
    await session.setLook({ preset: "nuvo", mode: "light" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await session.setSize({ width: 1920, height: 1080 });
    await startTour(page, "ru");
    let key = "";
    for (;;) {
      key = await nextStep(page, key);
      if (key === "end") break;
      const target = (await geometry(page)).target;
      if (target === "search-bar" || target === "queue" || target === "sound-panel" || target === "presets") {
        await session.setSize({ width: 1100, height: 705 });
        check(await settled(page), `after a shrink "${key}"`);
        await session.setSize({ width: 1600, height: 900 });
        check(await settled(page), `after a grow "${key}"`);
        await session.setSize({ width: 1920, height: 1080 });
      }
      if (target === "presets") {
        await session.setSize({ width: 1100, height: 705 });
        const hole = (await settled(page)).hole!;
        await page.mouse.move((hole.x + hole.right) / 2, (hole.y + hole.bottom) / 2);
        for (const delta of [120, 120, 120, 120, -120, -120, -120]) {
          await page.mouse.wheel(0, delta);
          const found = await settled(page);
          // Half scrolled away the outline keeps to what shows and the tip steps aside; fully away both leave
          if (found.callout) check(found, `after a scroll of ${delta} "${key}"`);
          else if (found.seen) check(found, `after a scroll of ${delta} "${key}"`, false);
          else expect.soft(found.hole, `scrolled away "${key}"`).toBeNull();
        }
        await session.setSize({ width: 1920, height: 1080 });
      }
      await next(page);
    }
  }, 600_000);
});
