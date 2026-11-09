import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";
import { diffRatio } from "./pixels";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DARK = { preset: "nuvo", mode: "dark" } as const;
const NO_LYRICS = "Looks like we don't have lyrics for this one yet.";
let session: NuvoSession;
let provider: http.Server;

beforeAll(async () => {
  provider = http.createServer((_request, response) => void response.writeHead(404).end());
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.NUVO_CORE_LRCLIB_URL = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  session = await launchNuvo({ profile: "seeded" });
});

afterAll(async () => {
  await session?.close();
  provider?.close();
  delete process.env.NUVO_CORE_LRCLIB_URL;
});

it("with the background hidden, both sizes differ from the references by at most 1 % of pixels", async () => {
  const page = session.page;
  await session.go("#/player");
  await session.setLook(DARK);
  await page.addStyleTag({ content: "canvas, [data-add-lyrics] { visibility: hidden !important }" });
  await page.getByText(NO_LYRICS).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const files = await session.shoot("1-karaoke", "karaoke", "dark", { looks: [DARK] });
  expect(files).toHaveLength(2);
  for (const file of files) {
    const width = /-(\d+)\.png$/.exec(file)![1];
    const reference = path.join(ROOT, "e2e", "reference", `karaoke-nuvo-dark-${width}.png`);
    expect(await diffRatio(session.app, reference, file), `karaoke ${width}`).toBeLessThanOrEqual(0.01);
  }
});

it("the island cover raises the view in dark within 400 ms, Escape takes it back down", async () => {
  const page = session.page;
  await session.go("#/");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('button[aria-label="Open lyrics"]').first().click();
  const started = Date.now();
  const overlay = page.locator("[data-phase]");
  await overlay.waitFor({ timeout: 2_000 });
  expect(await overlay.getAttribute("data-theme")).toBe("dark");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-phase]")!).transform === "none", undefined, { timeout: 2_000, polling: 16 });
  expect(Date.now() - started).toBeLessThan(400);
  await page.keyboard.press("Escape");
  await overlay.waitFor({ state: "detached", timeout: 2_000 });
});
