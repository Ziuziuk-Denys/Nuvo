import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, RECORDING, type NuvoSession } from "./harness";
import { diffRatio } from "./pixels";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const STEP = "0-baseline";
const ARTIST_ID = "UCiMhD4jzUqG-IgPzUmmytRQ";

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

async function online(): Promise<boolean> {
  try {
    const res = await fetch("https://music.youtube.com", { signal: AbortSignal.timeout(5_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

describe("baseline screenshots", () => {
  it("fresh profile: Home after the phrase step", async () => {
    const fresh = await launchNuvo({ profile: "fresh" });
    try {
      await passFirstRun(fresh.page);
      await fresh.go("#/");
      const files = await fresh.shoot(STEP, "home", "fresh");
      expect(files).toHaveLength(12);
    } finally {
      await fresh.close();
    }
  });

  it("seeded profile: every screen", async () => {
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    const page = live.page;
    const report = live.seed!;

    await live.go("#/");
    await live.shoot(STEP, "home", "seeded");

    await live.go("#/library");
    for (const tab of ["All", "Playlists", "Albums", "Artists"]) {
      await live.shoot(STEP, "library", tab.toLowerCase(), {
        prepare: async () => {
          await page.getByRole("tab", { name: tab, exact: true }).first().click();
          await page.waitForTimeout(400);
        },
      });
    }

    await live.go(`#/library/playlist?id=${report.bigPlaylistId}`);
    await live.shoot(STEP, "playlist", "big");
    await live.go(`#/library/playlist?id=${report.emptyPlaylistId}`);
    await live.shoot(STEP, "playlist", "empty");

    await live.go("#/");
    await live.shoot(STEP, "search", "queen", {
      prepare: async () => {
        await page.keyboard.press("/");
        await page.waitForTimeout(400);
        await page.keyboard.type("queen");
        await page.waitForTimeout(1_500);
      },
    });
    await page.keyboard.press("Escape");

    await live.shoot(STEP, "settings", "appearance", {
      prepare: async () => {
        await live.go("#/settings?section=appearance");
        await page.locator("[role=dialog]").first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(500);
      },
    });
    await live.shoot(STEP, "settings", "about", {
      prepare: async () => {
        await live.go("#/settings?section=about");
        await page.locator("[role=dialog]").first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(500);
      },
    });
    await page.keyboard.press("Escape");

    await live.go("#/");
    await live.shoot(STEP, "queue", "open", {
      prepare: async () => {
        await page.keyboard.press("q");
        await page.waitForTimeout(600);
      },
    });
    await page.keyboard.press("q");

    if (await online()) {
      await live.go(`#/artist?id=${ARTIST_ID}`);
      await page.waitForTimeout(4_000);
      await live.shoot(STEP, "artist", "queen");
      const album = page.locator('a[href*="collection?type=album"]').first();
      if (await album.count()) {
        await album.click();
        await page.waitForTimeout(4_000);
        await live.shoot(STEP, "album", "first");
      } else {
        console.warn("offline: no album link found on the artist page");
      }
    } else {
      console.warn("offline: music.youtube.com did not answer, artist and album shots skipped");
    }
  }, 900_000);

  it("pixels self-check", async () => {
    const dir = path.join(ROOT, "e2e", "artifacts", "ui", STEP);
    const home = path.join(dir, "home-seeded-nuvo-dark-1200.png");
    const library = path.join(dir, "library-all-nuvo-dark-1200.png");
    expect(fs.existsSync(home) && fs.existsSync(library)).toBe(true);
    const app = session!.app;
    expect(await diffRatio(app, home, home)).toBe(0);
    expect(await diffRatio(app, home, library)).toBeGreaterThan(0.01);
  });

  it.runIf(RECORDING)("karaoke reference", async () => {
    await session!.close();
    const live = await launchNuvo({ profile: "seeded" });
    session = live;
    const page = live.page;
    const look = { preset: "nuvo" as const, mode: "dark" as const };
    await live.go("#/player");
    await live.setLook(look);
    await page.addStyleTag({ content: "canvas { visibility: hidden !important }" });
    await page.waitForTimeout(2_000);
    const files = await live.shoot("reference", "karaoke", "dark", { looks: [look] });
    expect(files).toHaveLength(2);
    for (const file of files) {
      const width = /-(\d+)\.png$/.exec(file)![1];
      fs.copyFileSync(file, path.join(ROOT, "e2e", "reference", `karaoke-nuvo-dark-${width}.png`));
    }
  });
});
