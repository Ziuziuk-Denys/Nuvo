import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

let session: NuvoSession | undefined;

afterAll(async () => {
  await session?.close();
});

async function choose(live: NuvoSession, option: "Top" | "Side"): Promise<void> {
  await live.go("#/settings?section=theme");
  const dialog = live.page.getByRole("dialog");
  await dialog.getByRole("group", { name: "Navigation" }).getByRole("button", { name: option, exact: true }).click();
  await live.page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await live.page.waitForTimeout(700);
}

function shown(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll(
    (nodes) =>
      nodes.filter((node) => {
        for (let at: Element | null = node; at; at = at.parentElement) {
          const style = getComputedStyle(at);
          if (Number(style.opacity) < 0.5 || style.visibility === "hidden" || style.display === "none") return false;
        }
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      }).length,
  );
}

describe("navigation", () => {
  it("shows the top bar buttons again after switching from the side rail back to the top", async () => {
    session = await launchNuvo({ profile: "seeded" });
    const { page } = session;
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await choose(session, "Side");
    expect(await shown(page, "aside a[data-nav]")).toBe(4);

    await choose(session, "Top");
    expect(await page.locator("aside a[data-nav]").count()).toBe(0);
    expect(await shown(page, "header [data-nav]")).toBe(4);
    expect(await shown(page, 'header button[aria-label="Settings"]')).toBe(1);
  });

  it("shows the top bar after the lyrics view opens and closes before the bar has faded out", async () => {
    const { page } = session!;
    await session!.go("#/library");
    await page.evaluate(async () => {
      location.hash = "#/player";
      await new Promise((resolve) => setTimeout(resolve, 60));
      location.hash = "#/library";
    });
    await page.waitForTimeout(1_000);
    expect(await shown(page, "header [data-nav]")).toBe(4);
  });

  it("shows the top bar buttons after starting with the side rail and switching to the top", async () => {
    const live = session!;
    const { page } = live;
    await choose(live, "Side");
    await page.waitForTimeout(1_100);
    await page.reload();
    await page.locator("aside [data-nav]").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await choose(live, "Top");
    expect(await shown(page, "header [data-nav]")).toBe(4);
  });

  it("shows the top bar buttons after switching inside the open settings, slowly and quickly", async () => {
    const live = session!;
    const { page } = live;
    for (const pause of [900, 60]) {
      await live.go("#/settings?section=theme");
      const group = page.getByRole("dialog").getByRole("group", { name: "Navigation" });
      await group.getByRole("button", { name: "Side", exact: true }).click();
      await page.waitForTimeout(pause);
      await group.getByRole("button", { name: "Top", exact: true }).click();
      await page.waitForTimeout(900);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
      expect(await shown(page, "header [data-nav]"), `pause ${pause}`).toBe(4);
    }
  });

  describe("side rail", () => {
    const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
    const scrollTop = (page: Page) => page.locator(".n-scroll[data-beside-rail]").evaluate((node) => Math.round(node.scrollTop));
    const scrollTo = (page: Page, top: number) =>
      page.locator(".n-scroll[data-beside-rail]").evaluate((node, value) => {
        node.scrollTop = value;
      }, top);

    it("stands beside the content and the player with one gap, closed and open", async () => {
      const live = session!;
      const { page } = live;
      await choose(live, "Side");
      await live.go("#/library");
      for (const width of [1100, 1600]) {
        await live.setSize({ width, height: 800 });
        for (const rail of [64, 208]) {
          const toggle = page.locator("aside").getByRole("button", { name: rail === 64 ? "Hide names" : "Show names" });
          if (await toggle.isVisible()) await toggle.click();
          await page.waitForTimeout(500);
          const aside = await box(page, "aside[data-window-drag]");
          const island = await box(page, "[data-island]");
          expect([aside.x, aside.width, aside.y + aside.height], `${width} ${rail}`).toEqual([6, rail, 794]);
          expect([island.x, island.x + island.width]).toEqual([rail + 12, width - 6]);
          expect((await box(page, ".n-scroll[data-beside-rail]")).x).toBe(rail + 12);
          expect((await box(page, "header")).x).toBe(rail + 6);
          const header = await page.locator("header button:visible").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
          expect(Math.max(...header)).toBeLessThanOrEqual(width);
        }
      }
    });

    it("keeps long names inside the open rail and stays open after a restart", async () => {
      const { page } = session!;
      await page.waitForTimeout(1_100);
      await page.reload();
      await page.locator("aside[data-open] [data-pin]").first().waitFor({ timeout: 30_000 });
      const right = (await box(page, "aside[data-window-drag]")).width + 6;
      const names = await page.locator("aside [data-rail-item]").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
      expect(Math.max(...names)).toBeLessThanOrEqual(right);
      await page.locator("aside").getByRole("button", { name: "Hide names" }).click();
    });

    it("opens the same search as Ctrl+K from its icon, and hides the field again", async () => {
      const { page } = session!;
      const field = page.locator("header [role=combobox]");
      expect(await field.isVisible()).toBe(false);
      await page.locator('[data-nav="search"]').click();
      await expect.poll(() => field.evaluate((node) => node === document.activeElement)).toBe(true);
      await page.keyboard.type("glass");
      await page.getByRole("listbox").first().waitFor();
      await page.locator('[data-nav="search"]').click();
      await expect.poll(() => field.isVisible()).toBe(false);
      await page.keyboard.press("Control+K");
      await expect.poll(() => field.isVisible()).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(() => field.isVisible()).toBe(false);
    });

    it("goes back and forward by button, key and mouse, and returns to the same place", async () => {
      const live = session!;
      const { page } = live;
      const back = page.locator("header").getByRole("button", { name: "Back" });
      const forward = page.locator("header").getByRole("button", { name: "Forward" });
      const at = () => page.evaluate(() => location.hash.split("?")[0]);
      await page.locator('[data-nav="library"]').click();
      await page.waitForTimeout(700);
      await scrollTo(page, 400);
      const library = await scrollTop(page);
      expect(library).toBeGreaterThan(100);
      await page.locator("[data-pin=playlist]").first().click();
      await page.waitForTimeout(700);
      expect(await scrollTop(page)).toBe(0);
      expect(await forward.isDisabled()).toBe(true);
      await scrollTo(page, 900);
      const list = await scrollTop(page);
      expect(list).toBeGreaterThan(400);

      await back.click();
      await expect.poll(() => scrollTop(page)).toBe(library);
      expect(await at()).toBe("#/library");
      await forward.click();
      await expect.poll(() => scrollTop(page)).toBe(list);
      await page.keyboard.press("Alt+ArrowLeft");
      await expect.poll(at).toBe("#/library");
      await page.keyboard.press("Alt+ArrowRight");
      await expect.poll(at).toBe("#/library/playlist");
      await expect.poll(() => scrollTop(page)).toBe(list);

      const cdp = await page.context().newCDPSession(page);
      for (const [button, hash] of [
        ["back", "#/library"],
        ["forward", "#/library/playlist"],
      ] as const) {
        for (const type of ["mousePressed", "mouseReleased"] as const) {
          await cdp.send("Input.dispatchMouseEvent", { type, x: 700, y: 300, button, clickCount: 1 });
        }
        await expect.poll(at).toBe(hash);
      }
    });

    it("leaves the top layout as it was", async () => {
      const live = session!;
      await choose(live, "Top");
      expect(await live.page.locator("header").getByRole("button", { name: "Forward" }).count()).toBe(0);
      expect((await box(live.page, "[data-island]")).x).toBe(6);
      expect((await box(live.page, "header")).x).toBe(0);
      expect(await shown(live.page, "header [role=combobox]")).toBe(1);
    });
  });
});
