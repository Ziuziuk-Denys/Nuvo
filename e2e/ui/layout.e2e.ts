import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type Look, type NuvoSession, type Size } from "./harness";

const SHOTS = process.env.LAYOUT_SHOTS;
const SIZES: Size[] = [
  { width: 1100, height: 705 },
  { width: 1920, height: 1080 },
];
const LOOKS: Look[] = [
  { preset: "nuvo", mode: "light" },
  { preset: "nuvo", mode: "dark" },
];

interface Screen {
  name: string;
  open: (session: NuvoSession) => Promise<void>;
}

const route = (hash: string) => async (session: NuvoSession) => {
  await session.page.keyboard.press("Escape");
  await session.go(hash);
  await session.page.waitForTimeout(700);
};

const press = (hash: string, selector: string) => async (session: NuvoSession) => {
  await route(hash)(session);
  await session.page.locator(selector).first().click();
  await session.page.waitForTimeout(600);
};

const SCREENS: Screen[] = [
  { name: "home", open: route("#/") },
  { name: "library", open: route("#/library") },
  { name: "library-playlists", open: route("#/library?tab=playlists") },
  { name: "library-albums", open: route("#/library?tab=albums") },
  { name: "library-artists", open: route("#/library?tab=artists") },
  { name: "library-local", open: route("#/library?tab=local") },
  { name: "liked", open: route("#/library/playlist?id=likes") },
  { name: "playlist", open: async (session) => route(`#/library/playlist?id=${encodeURIComponent(session.seed!.bigPlaylistId)}`)(session) },
  { name: "recognize", open: route("#/recognize") },
  { name: "stats", open: route("#/stats") },
  {
    name: "palette",
    open: async (session) => {
      await route("#/")(session);
      const before = await mainEdges(session.page);
      await session.page.keyboard.press("Control+K");
      await session.page.waitForTimeout(400);
      expect.soft(await mainEdges(session.page), "opening search moves the page").toEqual(before);
      await session.page.keyboard.type("Ночные");
      await session.page.waitForTimeout(900);
    },
  },
  { name: "queue", open: press("#/", '[data-tour="queue"]') },
  { name: "sound", open: press("#/", '[data-tour="sound"]') },
  { name: "add", open: press("#/", '[data-tour="add"]') },
  { name: "lyrics", open: press("#/", "[data-tour=lyrics]") },
  { name: "import", open: press("#/library", 'button[data-tour="library-import"]') },
];

const OVERLAYS = "header, [role=dialog], [data-island], [data-tour-layer]";

const mainEdges = (page: Page) =>
  page.evaluate(
    (overlays) =>
      [...document.querySelectorAll("h1, h2")]
        .filter((heading) => !heading.closest(overlays))
        .map((heading) => Math.round(heading.getBoundingClientRect().right)),
    OVERLAYS,
  );

// Every way a box can break: text cut or spilling, a box past the window, content under the top bar
async function faults(page: Page): Promise<string[]> {
  return page.evaluate((overlays) => {
    const found: string[] = [];
    const name = (element: Element) => {
      const text = (element.textContent ?? "").trim().slice(0, 40);
      return `${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? "." + element.className.split(" ")[0] : ""} "${text}"`;
    };
    const shown = (element: Element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
    };
    const clipped = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX !== "visible" || style.overflowY !== "visible" || style.clipPath !== "none" || style.contain.includes("paint")) return true;
      }
      return false;
    };
    const bar = document.querySelector("header")?.getBoundingClientRect();
    for (const element of document.querySelectorAll("body *")) {
      if (element.closest("[aria-hidden=true], [inert], svg, canvas, [data-tour-layer]")) continue;
      if (!shown(element)) continue;
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const style = getComputedStyle(element);
      const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
      if (ownText && element instanceof HTMLElement && !(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        const wide = element.scrollWidth > element.clientWidth + 1;
        const tall = element.scrollHeight > element.clientHeight + 2;
        const clamp = style.webkitLineClamp !== "none" && style.webkitLineClamp !== "";
        if (wide && style.overflowX === "visible" && style.display !== "inline" && style.display !== "contents") found.push(`text spills: ${name(element)}`);
        if (wide && style.overflowX !== "visible" && style.textOverflow !== "ellipsis") found.push(`text cut: ${name(element)}`);
        if (tall && style.overflowY !== "visible" && !clamp && style.overflowY !== "auto" && style.overflowY !== "scroll")
          found.push(`text cut at the bottom: ${name(element)}`);
      }
      const outside = box.right > innerWidth + 1 || box.left < -1 || box.bottom > innerHeight + 1;
      if (outside && !clipped(element) && style.position !== "fixed") found.push(`past the window: ${name(element)}`);
      if (bar && element.matches("h1, h2") && !element.closest(overlays) && box.top < bar.bottom - 1 && box.bottom > 0)
        found.push(`under the top bar: ${name(element)}`);
    }
    return [...new Set(found)];
  }, OVERLAYS);
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), scale: "css", type: "jpeg", quality: 55, timeout: 10_000 }).catch(() => undefined);
}

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

describe("layout", () => {
  it("every screen, panel and settings section holds together in both languages, both modes and at the smallest and a full HD window", async () => {
    session = await launchNuvo({ profile: "seeded" });
    const page = session.page;
    for (const locale of ["ru", "en"] as const) {
      await page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
      for (const look of LOOKS) {
        await session.setLook(look);
        await page.emulateMedia({ reducedMotion: "reduce" });
        for (const size of SIZES) {
          await session.setSize(size);
          const run = `${locale}-${look.mode}-${size.width}`;
          for (const screen of SCREENS) {
            await screen.open(session);
            expect.soft(await faults(page), `${run} ${screen.name}`).toEqual([]);
            await shoot(page, `${run}-${screen.name}`);
          }
          await page.keyboard.press("Escape");
          await session.go("#/settings?section=playback");
          const sections = await page.locator("[role=dialog] [data-section]").evaluateAll((items) => items.map((item) => item.getAttribute("data-section")!));
          for (const section of sections) {
            await page.locator(`[role=dialog] [data-section="${section}"]`).click();
            const panel = page.locator("[role=dialog] [role=tabpanel]");
            await panel.waitFor({ timeout: 10_000 });
            await page.waitForTimeout(400);
            for (let part = 0; ; part += 1) {
              expect.soft(await faults(page), `${run} settings ${section} ${part}`).toEqual([]);
              await shoot(page, `${run}-settings-${section}-${part}`);
              const end = await panel.evaluate((element) => {
                const before = element.scrollTop;
                element.scrollTop += element.clientHeight * 0.9;
                return element.scrollTop === before;
              });
              if (end) break;
              await page.waitForTimeout(250);
            }
          }
        }
      }
    }
  }, 1_800_000);
});
