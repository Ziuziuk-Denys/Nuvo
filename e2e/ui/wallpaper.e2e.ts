import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

// 2x2 opaque PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPUiFrAwMDAxMDAwMDAAAANSgEmo0LrwgAAAABJRU5ErkJggg==", "base64");

let live: NuvoSession;

beforeAll(async () => {
  live = await launchNuvo({ profile: "seeded" });
}, 180_000);

afterAll(async () => {
  await live?.close();
});

it("wallpaper sliders at their maximum never widen the settings page", { timeout: 120_000 }, async () => {
  const { page } = live;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-wallpaper-")), "wall.png");
  fs.writeFileSync(file, PNG);
  await live.setSize({ width: 1200, height: 780 });
  await live.go("#/settings?section=customization");
  await page.locator('[role=dialog] input[type="file"]').first().setInputFiles(file);
  const sliders = page.locator("[role=dialog] [role=slider]");
  await sliders.first().waitFor();
  for (const index of [0, 1]) {
    await sliders.nth(index).focus();
    await page.keyboard.press("End");
  }
  await expect.poll(() => sliders.nth(1).getAttribute("aria-valuenow")).toBe(await sliders.nth(1).getAttribute("aria-valuemax"));
  const body = page.locator("[role=dialog] [class*=_body_].n-scroll");
  const { scroll, client } = await body.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(scroll).toBe(client);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
