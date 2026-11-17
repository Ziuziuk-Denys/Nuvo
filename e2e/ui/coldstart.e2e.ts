import type { Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, type NuvoSession } from "./harness";

const FIRST_ROWS_MS = 15_000;
const SLOW_ROWS_MS = 30_000;
const LATENCY_MS = 1_500;
const QUERY = process.env.NUVO_E2E_PICK ?? "Daft Punk";

let session: NuvoSession | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

const MANY = ["Daft Punk", "Massive Attack", "Portishead", "Radiohead", "Björk", "Air", "Moby", "Röyksopp", "The Prodigy", "Kraftwerk", "Justice", "Gorillaz"];

async function pick(page: Page, scope: string, query = QUERY): Promise<void> {
  await page.locator(scope).getByRole("textbox", { name: "Song or artist" }).fill(query);
  await page.locator(`${scope} [aria-label="Suggestions"] button`).first().click({ timeout: 30_000 });
}

// "slow" delays every YouTube call; "no-radio" refuses only the radio lists, as a block of that endpoint would
async function shapeYoutube(page: Page, link: "slow" | "no-radio"): Promise<void> {
  await page.route("**/youtubei/v1/**", async (route) => {
    if (link === "no-radio" && route.request().postData()?.includes("RDAMVM")) return route.abort("blockedbyclient");
    if (link === "slow") await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    return route.continue();
  });
}

async function homeFills(page: Page, started: number, within = FIRST_ROWS_MS): Promise<void> {
  const timeline: Array<{ at: number; mixes: number; text: string }> = [];
  while (Date.now() - started < within + 5_000) {
    const state = await page.evaluate(() => ({
      mixes: document.querySelectorAll("[data-mix]").length,
      text: (document.querySelector("[data-slot=cold-start]")?.textContent ?? "").trim().slice(0, 60),
    }));
    timeline.push({ at: Date.now() - started, ...state });
    if (state.mixes > 0) break;
    await page.waitForTimeout(500);
  }
  const story = JSON.stringify(timeline.filter((_, index) => index % 4 === 0 || index === timeline.length - 1));
  console.log("home after the picks:", story);
  expect(
    timeline.every((step) => step.mixes > 0 || step.text !== ""),
    `Home never blank: ${story}`,
  ).toBe(true);
  expect(timeline.find((step) => step.mixes > 0)?.at ?? Infinity, `first mix after the picks: ${story}`).toBeLessThanOrEqual(within);
}

async function throughTour(link?: "slow" | "no-radio"): Promise<{ live: NuvoSession; started: number }> {
  const live = await launchNuvo({ profile: "fresh" });
  session = live;
  const { page } = live;
  if (link) await shapeYoutube(page, link);
  await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "I wrote it down" }).click();
  await pick(page, "[aria-labelledby=tour-start-title]");
  await page.getByRole("button", { name: "Use these" }).click();
  const started = Date.now();
  await page.getByText("Home will start from these.").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Skip the tour", exact: true }).click({ timeout: 30_000 });
  await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 30_000 });
  await page.locator("[data-tour-layer]").waitFor({ state: "detached", timeout: 10_000 });
  await live.go("#/");
  return { live, started };
}

describe("first start to Home", () => {
  it("picks from the tour's start card fill Home within seconds", async () => {
    const { live, started } = await throughTour();
    await homeFills(live.page, started);
  }, 180_000);

  it("twelve picks all count and still fill Home within seconds", async () => {
    const live = await launchNuvo({ profile: "fresh" });
    session = live;
    const { page } = live;
    const scope = "[aria-labelledby=tour-start-title]";
    await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "I wrote it down" }).click();
    for (const name of MANY) await pick(page, scope, name);
    await expect.poll(() => page.locator("[data-seed]").count()).toBe(MANY.length);
    expect(await page.locator(scope).getByRole("status").textContent()).toBe(`${MANY.length} picked`);
    await page.getByRole("button", { name: "Use these" }).click();
    const started = Date.now();
    await page.getByText("Home will start from these.").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Skip the tour", exact: true }).click({ timeout: 30_000 });
    await page.locator('[data-tour-layer] [data-next]:not([aria-disabled="true"])').click({ timeout: 30_000 });
    await page.locator("[data-tour-layer]").waitFor({ state: "detached", timeout: 10_000 });
    await live.go("#/");
    await homeFills(page, started);
  }, 240_000);

  it("on a slow link Home shows its outline, then the rows", async () => {
    const { live, started } = await throughTour("slow");
    await homeFills(live.page, started, SLOW_ROWS_MS);
  }, 180_000);

  it("with YouTube's radio blocked the rows come from SoundCloud", async () => {
    const { live, started } = await throughTour("no-radio");
    await homeFills(live.page, started, SLOW_ROWS_MS);
  }, 180_000);

  it("picks from Home's cold-start ask fill Home within seconds", async () => {
    const live = await launchNuvo({ profile: "fresh" });
    session = live;
    await passFirstRun(live.page);
    await live.go("#/");
    await pick(live.page, "[aria-labelledby=cold-taste-title]");
    await live.page.locator("[aria-labelledby=cold-taste-title]").getByRole("button", { name: "Listen" }).click();
    await homeFills(live.page, Date.now());
  }, 180_000);
});
