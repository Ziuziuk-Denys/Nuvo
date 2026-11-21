import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

const WIDTHS = [1100, 1280, 1440];
const HEIGHT = 800;
const ZOOMS = [1, 1.5];
const TABS = { all: 0, local: 4 };

let session: NuvoSession | null = null;
afterAll(async () => {
  await session?.close();
});

async function setZoom(live: NuvoSession, factor: number): Promise<void> {
  await live.app.evaluate(({ BrowserWindow }, value) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomFactor(value);
  }, factor);
  await live.page.waitForTimeout(400);
}

function toolbarFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const tablist = document.querySelector('[role="tablist"]')!;
    const bar = tablist.parentElement!.getBoundingClientRect();
    const tabs = tablist.getBoundingClientRect();
    const faults: string[] = [];
    const tools = [...tablist.parentElement!.querySelectorAll<HTMLElement>('[role="search"], button')].filter((el) => !tablist.contains(el));
    for (const tool of tools) {
      const box = tool.getBoundingClientRect();
      const name = tool.getAttribute("aria-label") ?? tool.textContent ?? tool.tagName;
      if (box.left < tabs.right - 0.5) faults.push(`${name} overlaps the tabs`);
      if (box.right > bar.right + 0.5) faults.push(`${name} is cut at the right edge`);
      if (Math.abs(box.top + box.height / 2 - (tabs.top + tabs.height / 2)) > 4) faults.push(`${name} left the tab row`);
    }
    for (const label of tablist.parentElement!.querySelectorAll<HTMLElement>("button span")) {
      if (label.offsetWidth > 0 && label.scrollWidth > label.clientWidth + 1) faults.push(`label "${label.textContent}" is clipped`);
    }
    const input = tablist.parentElement!.querySelector("input")!;
    if (input.offsetWidth > 32) {
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if (context.measureText(input.placeholder).width > input.clientWidth + 1) faults.push(`placeholder "${input.placeholder}" is clipped`);
    }
    return faults;
  });
}

describe("library toolbar", () => {
  it("never overlaps or clips in English and Russian at 1100, 1280 and 1440 px and at 150 % scale", { timeout: 600_000 }, async () => {
    session = await launchNuvo({ profile: "seeded" });
    const live = session;
    const found: string[] = [];
    for (const locale of ["en", "ru"]) {
      await live.page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
      await live.page.reload();
      await live.page.waitForLoadState("domcontentloaded");
      await live.go("#/library");
      await live.page.locator('[role="tablist"]').waitFor();
      for (const width of WIDTHS) {
        await setZoom(live, 1);
        await live.setSize({ width, height: HEIGHT });
        for (const zoom of ZOOMS) {
          await setZoom(live, zoom);
          for (const [tab, index] of Object.entries(TABS)) {
            await live.page.locator('[role="tab"]').nth(index).click();
            await live.page.waitForTimeout(300);
            for (const fault of await toolbarFaults(live.page)) found.push(`${locale} ${width}px x${zoom} ${tab}: ${fault}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
