import fs from "node:fs";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

const SHOTS = process.env.THEME_SHOTS;

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

it("the chosen theme wears a ring around its icon, not a plate, and hover and focus look different", async () => {
  session = await launchNuvo({ profile: "seeded" });
  const page = session.page;
  await session.setSize({ width: 1100, height: 705 });
  for (const mode of ["light", "dark"] as const) {
    await session.setLook({ preset: "nuvo", mode });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await session.go("#/settings?section=appearance");
    const grid = page.locator('[data-tour="presets"]');
    await grid.waitFor({ timeout: 10_000 });
    const ids = await grid.locator("[data-preset]").evaluateAll((items) => items.map((item) => item.getAttribute("data-preset")!));
    for (const id of ids) {
      await grid.locator(`[data-preset="${id}"]`).click();
      await expect.poll(() => grid.locator(`[data-preset="${id}"]`).getAttribute("aria-pressed")).toBe("true");
      const other = ids.find((item) => item !== id)!;
      await grid.locator(`[data-preset="${other}"]`).hover();
      await page.waitForTimeout(400);
      const look = await grid.evaluate(
        (element, [chosen, hovered]) => {
          // Computed colours come back as rgb() or color(srgb 0-1 / alpha)
          const rgba = (selector: string, property: "outlineColor" | "color" | "backgroundColor") => {
            const value = getComputedStyle(element.querySelector(selector)!)[property];
            const parts = value.match(/[\d.]+/g)!.map(Number);
            const scale = value.startsWith("color(") ? 255 : 1;
            return [parts[0] * scale, parts[1] * scale, parts[2] * scale, parts[3] ?? 1];
          };
          return {
            plate: rgba(`button[data-preset="${chosen}"]`, "backgroundColor")[3],
            ring: rgba(`button[data-preset="${chosen}"] img`, "outlineColor"),
            ink: rgba(`button[data-preset="${chosen}"] span`, "color"),
            hover: rgba(`button[data-preset="${hovered}"] img`, "outlineColor")[3],
          };
        },
        [id, other] as const,
      );
      expect.soft(look.plate, `${mode} ${id}: no plate behind the chosen theme`).toBe(0);
      const inked = look.ring.slice(0, 3).every((value, index) => Math.abs(value - look.ink[index]) <= 3);
      expect.soft(inked && look.ring[3] === 1, `${mode} ${id}: the ring ${look.ring} is solid ink ${look.ink}`).toBe(true);
      expect.soft(look.hover > 0 && look.hover < 0.5, `${mode} ${id}: hover is a faint ring (${look.hover})`).toBe(true);
    }
    await grid.locator('[data-preset="nuvo"]').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await grid.screenshot({ path: path.join(SHOTS, `presets-${mode}.png`) });
    }
    await grid.locator('[data-preset="nuvo"]').focus();
    await page.keyboard.press("ArrowRight");
    const focus = await grid.evaluate((element) => {
      const focused = element.querySelector(":focus-visible");
      return focused ? getComputedStyle(focused).outlineStyle : "none";
    });
    expect.soft(focus, `${mode}: keyboard focus shows its own outline`).toBe("solid");
  }
}, 300_000);
