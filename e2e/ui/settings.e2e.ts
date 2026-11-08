import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type Look, type NuvoSession, type Size } from "./harness";

const STEP = process.env.SETTINGS_STEP ?? "6-settings";
const SECTIONS = ["about", "appearance", "playback", "sound", "notch", "youtube", "lastfm", "discord", "storage", "shortcuts"];
const LOOKS: Look[] = [
  { preset: "nuvo", mode: "light" },
  { preset: "nuvo", mode: "dark" },
];
const WIDE: Size[] = [{ width: 1200, height: 780 }];
const NARROW: Size[] = [{ width: 1100, height: 705 }];

const sessions: NuvoSession[] = [];

afterAll(async () => {
  for (const session of sessions) await session.close();
});

async function shootSections(live: NuvoSession, sizes: Size[], looks: Look[], suffix = ""): Promise<void> {
  const page = live.page;
  for (const section of SECTIONS) {
    await live.shoot(STEP, "settings", `${section}${suffix}`, {
      looks,
      sizes,
      prepare: async () => {
        await live.go(`#/settings?section=${section}`);
        await page.locator("[role=dialog] h2").first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(600);
      },
    });
  }
}

describe("settings", () => {
  it("every section in light and dark, no links in About, then Russian at 1100", { timeout: 900_000 }, async () => {
    const live = await launchNuvo({ profile: "seeded" });
    sessions.push(live);
    await shootSections(live, WIDE, LOOKS);

    // Discord presence is off until the user turns it on, and only main knows the choice
    await live.go("#/settings?section=discord");
    const discordSwitch = live.page.locator("[role=dialog] [role=switch]").first();
    await discordSwitch.waitFor({ timeout: 10_000 });
    expect(await discordSwitch.getAttribute("aria-checked")).toBe("false");
    await discordSwitch.click();
    await live.page.waitForTimeout(300);
    expect(await live.page.evaluate(async () => (await window.nuvoShell!.getMainSettings()).discord.enabled)).toBe(true);
    await discordSwitch.click();
    await live.page.waitForTimeout(300);
    expect(await live.page.evaluate(async () => (await window.nuvoShell!.getMainSettings()).discord.enabled)).toBe(false);

    await live.go("#/settings?section=about");
    expect(await live.page.locator("[role=dialog] a[href]").count()).toBe(0);
    await live.page.keyboard.press("Escape");
    await live.page.waitForTimeout(400);
    expect(await live.page.locator("[role=dialog]").count()).toBe(0);

    // the first run only speaks English, so Russian comes after it in the same profile
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await shootSections(live, NARROW, [{ preset: "nuvo", mode: "light" }], "-ru");
  });
});
