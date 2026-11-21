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
    expect(await shown(page, "aside [data-nav]")).toBe(4);

    await choose(session, "Top");
    expect(await page.locator("aside [data-nav]").count()).toBe(0);
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
});
