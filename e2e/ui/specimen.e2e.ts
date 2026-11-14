import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POPOVER } from "../../src/ui/geometry";
import { launchNuvo, MATRIX, SIZES, type Look, type NuvoSession } from "./harness";

// EDGE_PX in src/ui/components/layers.ts, which needs the app's import aliases
const POPOVER_EDGE_PX = 12;

const STEP = "specimen";
const DIR = path.resolve(import.meta.dirname, "..", "artifacts", "ui", STEP);
const SECTIONS = ["type", "colour", "bloom", "controls", "overlays", "motion"];
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };
const AMBER: Look = { preset: "amber", mode: "dark" };
const WIDE = { width: 1440, height: 900 };
const WIDE_LOOKS: Look[] = [LIGHT, DARK, AMBER, { preset: "ink", mode: "light" }];

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

async function scrollTo(live: NuvoSession, section: string): Promise<void> {
  await live.page.evaluate((id) => {
    document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: "start" });
  }, section);
  await live.page.waitForTimeout(300);
}

describe("specimen", () => {
  it("shows every foundation in every look", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    const page = live.page;
    await live.go("#/specimen");
    await page.getByRole("heading", { name: "Specimen" }).waitFor();

    const top = await live.shoot(STEP, "specimen", "top", { looks: MATRIX, sizes: SIZES });
    expect(top).toHaveLength(12);
    await live.shoot(STEP, "specimen", "top", { looks: WIDE_LOOKS, sizes: [WIDE] });

    for (const look of [LIGHT, DARK]) {
      await live.setLook(look);
      await live.setSize(SIZES[0]);
      for (const section of SECTIONS) {
        await scrollTo(live, section);
        await live.shoot(STEP, "specimen", section, { looks: [look], sizes: [SIZES[0]] });
      }
      expect(await page.locator("[data-low]").count(), `${look.preset}-${look.mode}`).toBe(0);
      expect(await page.locator("[data-swatch]").count()).toBe(9);
    }

    await live.setLook(LIGHT);
    const island = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === "Previous");
      return button ? getComputedStyle(button.parentElement!.parentElement!).backgroundColor : null;
    });
    expect(island).toBe("rgb(0, 0, 0)");

    await live.setLook(DARK);
    await live.setSize(SIZES[0]);
    await scrollTo(live, "bloom");
    await page.getByRole("button", { name: "Violet" }).click();
    await page.waitForTimeout(1_200);
    await live.shoot(STEP, "specimen", "bloom-violet", { looks: [DARK], sizes: [SIZES[0]] });
  }, 900_000);

  it("opens the popover family, a sheet and menus", async () => {
    const live = session ?? (await launchNuvo({ profile: "seeded" }));
    session = live;
    const page = live.page;
    const STEP_OVERLAYS = "1-overlays";
    await live.go("#/specimen");
    await page.getByRole("heading", { name: "Specimen" }).waitFor();

    const button = (name: string) => page.locator("[data-section=overlays]").getByRole("button", { name, exact: true });
    const dialog = page.getByRole("dialog");
    const reset = async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await button("Sound").evaluate((node) => node.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
    };
    const states: { state: string; open: () => Promise<void> }[] = [
      { state: "popover-560", open: () => button("Sound").click() },
      {
        state: "popover-320",
        open: async () => {
          await button("Sound").click();
          await dialog.getByRole("tab", { name: "Speed" }).click();
        },
      },
      { state: "sheet", open: () => button("New playlist").click() },
      { state: "menu", open: () => button("More").click() },
      {
        state: "context-menu",
        open: async () => {
          const row = page.locator("[data-section=overlays]").getByText("Midnight Ferry");
          const box = (await row.boundingBox())!;
          await page.mouse.click(box.x + 40, box.y + 8, { button: "right" });
        },
      },
    ];

    for (const look of [LIGHT, DARK, AMBER]) {
      await live.setLook(look);
      await live.setSize(SIZES[0]);
      for (const { state, open } of states) {
        await live.shoot(STEP_OVERLAYS, "specimen", state, {
          looks: [look],
          sizes: [SIZES[0]],
          prepare: async () => {
            await reset();
            await open();
            await page.waitForTimeout(500);
          },
        });
      }
    }

    await reset();
    await button("Sound").click();
    await dialog.getByRole("tab", { name: "Equalizer" }).click();
    await page.waitForTimeout(500);
    const measure = () =>
      page.evaluate((edge) => {
        const panel = document.querySelector('[role="dialog"]')!;
        const anchor = [...document.querySelectorAll("[data-section=overlays] button")].find((node) => node.textContent === "Sound")!;
        const a = anchor.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        (window as { __panel?: Element }).__panel ??= panel;
        return {
          width: p.width,
          gap: a.top - p.bottom,
          left: p.left,
          expectedLeft: Math.min(Math.max(a.left + a.width / 2 - p.width / 2, edge), innerWidth - p.width - edge),
          same: (window as { __panel?: Element }).__panel === panel,
        };
      }, POPOVER_EDGE_PX);
    const wide = await measure();
    expect(wide.width).toBeCloseTo(POPOVER.wide, 0);
    expect(wide.gap).toBeCloseTo(POPOVER.gap, 0);
    expect(wide.left).toBeCloseTo(wide.expectedLeft, 0);
    await dialog.getByRole("tab", { name: "Speed" }).click();
    await page.waitForTimeout(500);
    const narrow = await measure();
    expect(narrow.width).toBeCloseTo(POPOVER.narrow, 0);
    expect(narrow.same).toBe(true);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await dialog.getByRole("tab", { name: "Equalizer" }).click();
    await page.waitForTimeout(110);
    await page.screenshot({ path: path.join(DIR, "..", STEP_OVERLAYS, "specimen-popover-morphing-vinyl-dark-1200.png") });

    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    expect(await dialog.count()).toBe(0);
  }, 600_000);
});
