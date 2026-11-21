import { afterEach, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";
import { seedPools } from "./seed";

let session: NuvoSession | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

async function topAt(live: NuvoSession, x: number, y: number) {
  return live.page.evaluate(
    ([px, py]) => {
      const hit = document.elementFromPoint(px * innerWidth, py * innerHeight);
      return { inArc: Boolean(hit?.closest("[data-arc]")), tag: hit?.tagName ?? null };
    },
    [x, y],
  );
}

async function openOverHome(live: NuvoSession) {
  await live.go("#/");
  await live.page.locator("[data-arc] li button").first().waitFor({ timeout: 30_000 });
  await live.page.getByRole("button", { name: "Open lyrics" }).click();
  await live.page.waitForTimeout(1_500);
}

it("the karaoke view and Scene opened from Home sit over the Discover ring and take its clicks", async () => {
  const live = await launchNuvo({ profile: "seeded" });
  session = live;
  await seedPools(live);
  await live.page.evaluate(() =>
    localStorage.setItem("nuvo.visual", JSON.stringify({ enabled: true, stage: false, template: "emblem", toured: true, chosen: true })),
  );
  await live.page.reload();

  await openOverHome(live);
  for (const [x, y] of [
    [0.5, 0.35],
    [0.1, 0.12],
    [0.5, 0.55],
  ]) {
    expect(await topAt(live, x, y), `lyrics view at ${x},${y}`).toMatchObject({ inArc: false });
  }

  await live.page.locator('button[aria-label="Show the scene"]').click();
  await live.page.locator('button[aria-label="Show the lyrics"]').waitFor({ timeout: 15_000 });
  for (const [x, y] of [
    [0.5, 0.35],
    [0.1, 0.12],
    [0.5, 0.55],
  ]) {
    expect(await topAt(live, x, y), `scene at ${x},${y}`).toMatchObject({ inArc: false });
  }
}, 300_000);

it("a young profile with For you but no New to you still opens with the ring under a live sky", async () => {
  const live = await launchNuvo({ profile: "seeded" });
  session = live;
  await live.go("#/");
  await live.page.locator("[data-mix]").first().waitFor({ timeout: 30_000 });
  await live.page.locator("[data-arc] li button").first().waitFor({ timeout: 15_000 });
  await live.page.locator("[data-overlay]").waitFor({ state: "attached", timeout: 15_000 });
  await live.page.waitForTimeout(3_000);
  const sky = await live.page.evaluate(() => ({
    strict: document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true }) !== null,
    still: document.querySelector("[data-overlay] [data-still]") !== null,
  }));
  if (sky.strict) expect(sky.still, "a GPU that can draw the sky draws it").toBe(false);
}, 300_000);
