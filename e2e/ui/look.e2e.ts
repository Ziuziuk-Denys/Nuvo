import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type Look, type NuvoSession, type Size } from "./harness";

/** Screens of the theme editor, fonts and custom CSS in Settings (customization design 2, 6, 12). */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SHOTS = process.env.LOOK_SHOTS ?? path.join(os.homedir(), ".cache", "look-shots");
const WIDE: Size = { width: 1200, height: 780 };
const NARROW: Size = { width: 1100, height: 705 };

type Locale = "en" | "ru";
const dictionaries: Record<Locale, Record<string, unknown>> = {
  en: JSON.parse(fs.readFileSync(path.join(ROOT, "src", "i18n", "locales", "en.json"), "utf8")),
  ru: JSON.parse(fs.readFileSync(path.join(ROOT, "src", "i18n", "locales", "ru.json"), "utf8")),
};

/** The UI text of a key, so the same flow runs in both languages. */
function text(locale: Locale, key: string, params: Record<string, string> = {}): string {
  const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionaries[locale]);
  if (typeof found !== "string") throw new Error(`no ${locale} text for ${key}`);
  return Object.entries(params).reduce((value, [name, param]) => value.replace(`{${name}}`, param), found);
}

/** A small installed TTF or OTF to load as the owner's font file. */
function fontFixture(): string {
  const files = execFileSync("fc-list", [":", "file"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.replace(/:\s*$/, "").trim())
    .filter((file) => file.startsWith("/usr/share/fonts/") && /\.(ttf|otf)$/i.test(file) && fs.statSync(file).size < 2 * 1024 * 1024)
    .sort();
  if (files.length === 0) throw new Error("no installed TTF or OTF to use as a fixture");
  return files[0];
}

const sessions: NuvoSession[] = [];
afterAll(async () => {
  for (const session of sessions) await session.close();
});

async function stubDialogs(live: NuvoSession, open: string | null, save: string | null): Promise<void> {
  await live.app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: files.open === null, filePaths: files.open ? [files.open] : [] })) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => ({ canceled: files.save === null, filePath: files.save ?? "" })) as typeof dialog.showSaveDialog;
    },
    { open, save },
  );
}

/** Applies the look, size and locale, and returns a shooter that names files by state. */
async function prepare(live: NuvoSession, look: Look, size: Size, locale: Locale) {
  const page = live.page;
  await page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
  const custom = await page.evaluate(() => document.documentElement.dataset.preset?.startsWith("custom:") === true);
  if (custom) {
    // a saved theme is in force, so only the mode changes; the harness waits for a built-in preset
    await page.waitForTimeout(1_100);
    await page.evaluate((mode) => localStorage.setItem("theme", mode), look.mode);
    await page.reload();
    await page.waitForFunction(
      (mode) => document.documentElement.getAttribute("data-theme") === mode && (document.getElementById("root")?.childElementCount ?? 0) > 0,
      look.mode,
      { timeout: 30_000 },
    );
  } else {
    await live.setLook(look);
  }
  await live.setSize(size);
  await page.emulateMedia({ reducedMotion: "reduce" });
  fs.mkdirSync(SHOTS, { recursive: true });
  return async (state: string) => {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, `look-${state}-${locale}-${look.mode}-${size.width}.png`) });
  };
}

async function openSection(live: NuvoSession, section: "appearance" | "customization"): Promise<void> {
  await live.go(`#/`);
  await live.go(`#/settings?section=${section}`);
  await live.page.locator("[role=dialog] h2").first().waitFor({ timeout: 10_000 });
  await live.page.waitForTimeout(300);
}

const rootToken = (live: NuvoSession, name: string) =>
  live.page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);

describe("look", () => {
  it("edit colours live, warnings and the block, fonts, custom CSS, export and import with CSS, safe mode", { timeout: 900_000 }, async () => {
    const live = await launchNuvo({ profile: "seeded" });
    sessions.push(live);
    const page = live.page;
    const t = (key: string, params?: Record<string, string>) => text("en", key, params);
    const shoot = await prepare(live, { preset: "nuvo", mode: "light" }, WIDE, "en");
    const editor = page.locator(`aside[aria-label="${t("appearance.editor.label")}"]`);

    // a new theme opens the sheet over the live app, Settings steps aside
    await openSection(live, "appearance");
    await shoot("appearance");
    await page.getByRole("button", { name: t("appearance.theme.new_from") }).click();
    await editor.waitFor();
    await expect.poll(() => page.locator("[role=dialog][aria-modal=true]").count()).toBe(0);
    await shoot("editor");

    // a colour typed in the picker repaints the app
    await editor.getByRole("button", { name: t("appearance.editor.edit_role", { role: t("appearance.roles.accent.name") }) }).click();
    await page.getByLabel(t("appearance.picker.hex")).fill("#c2456b");
    await expect.poll(() => rootToken(live, "--n-accent")).toBe("#c2456b");
    await shoot("picker");
    await page.keyboard.press("Escape");

    // grey text warns, text the colour of the background blocks Save, Fix for me clears the warning
    const save = editor.getByRole("button", { name: t("appearance.editor.save"), exact: true });
    const editText = editor.getByRole("button", { name: t("appearance.editor.edit_role", { role: t("appearance.roles.ink.name") }) });
    await editText.click();
    await page.getByLabel(t("appearance.picker.hex")).fill("#9a9a9a");
    await page.keyboard.press("Escape");
    const warned = t("appearance.contrast.warn")
      .split("{ratio}")[0]
      .replace(/[\s·]+$/, "");
    await expect.poll(() => editor.textContent()).toContain(warned);
    expect(await save.isEnabled()).toBe(true);
    await shoot("contrast-warn");
    const field = await rootToken(live, "--n-field");
    await editText.click();
    await page.getByLabel(t("appearance.picker.hex")).fill(field);
    await page.keyboard.press("Escape");
    await expect.poll(() => save.isDisabled()).toBe(true);
    await shoot("contrast-blocked");
    await editor
      .getByRole("button", { name: t("appearance.contrast.fix") })
      .first()
      .click();
    await expect.poll(() => save.isEnabled()).toBe(true);

    // Save stores the theme and makes it the active look
    await save.click();
    await editor.waitFor({ state: "detached" });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.preset ?? "")).toMatch(/^custom:/);
    await page.locator("[role=dialog] h2").first().waitFor();
    await shoot("saved");

    // a font file loads and becomes the interface font
    const fixture = fontFixture();
    await stubDialogs(live, fixture, null);
    await page
      .getByRole("button", { name: t("appearance.fonts.load_file") })
      .first()
      .click();
    await expect.poll(() => rootToken(live, "--n-font-ui")).toContain("nuvo-user-");
    await page.locator(`[role=dialog]`).getByText(t("appearance.fonts.files")).scrollIntoViewIfNeeded();
    await shoot("fonts");
    await page.locator(`button[aria-haspopup=listbox][aria-label^="${t("appearance.fonts.lyrics")}: "]`).click();
    await page.getByRole("listbox").waitFor();
    await shoot("font-list");
    await page.keyboard.press("Escape");

    // custom CSS: a fetch is refused with its line, a clean sheet applies and survives Settings closing
    await openSection(live, "customization");
    await page.getByRole("button", { name: t("appearance.css.show"), exact: true }).click();
    const area = page.getByLabel(t("appearance.css.editor"));
    await area.fill("a { color: inherit }\nbody { background: url(https://example.org/x.png) }");
    await page.getByRole("button", { name: t("appearance.css.apply"), exact: true }).click();
    await expect
      .poll(() => page.locator("[role=dialog]").textContent())
      .toContain(t("appearance.css.line", { line: "2", message: t("appearance.css_errors.fetch") }));
    await shoot("css-refused");
    await area.fill(":root { --n-accent: #1f8a5b !important; }");
    await page.getByRole("button", { name: t("appearance.css.apply"), exact: true }).click();
    await expect.poll(() => rootToken(live, "--n-accent")).toBe("#1f8a5b");
    await shoot("css-applied");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2_500);
    expect(await page.locator("#nuvo-custom-css").count()).toBe(1);

    // export with the CSS, then import it back: the CSS is shown and only joins after the owner says so
    const exported = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-look-")), "shared.nuvotheme.json");
    await stubDialogs(live, exported, exported);
    await openSection(live, "appearance");
    await page.getByRole("switch", { name: t("appearance.theme.export_css") }).click();
    await page.getByRole("button", { name: t("appearance.theme.export") }).click();
    await expect.poll(() => fs.existsSync(exported)).toBe(true);
    const file = JSON.parse(fs.readFileSync(exported, "utf8"));
    expect(file.css).toContain("--n-accent");
    await page.getByRole("button", { name: t("appearance.theme.import") }).click();
    await page.getByRole("group", { name: t("appearance.theme.css_title") }).waitFor();
    expect(await page.locator("[role=dialog] pre").textContent()).toContain("--n-accent");
    await page.getByRole("group", { name: t("appearance.theme.css_title") }).scrollIntoViewIfNeeded();
    await shoot("import-css");
    await page.getByRole("button", { name: t("appearance.theme.colours_and_css") }).click();
    await editor.waitFor();
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    await page.getByRole("button", { name: t("appearance.theme.discard") }).click();
    fs.rmSync(path.dirname(exported), { recursive: true, force: true });

    // safe mode: the default look with the banner, and back on
    await openSection(live, "customization");
    await page.getByRole("button", { name: t("appearance.safe.reset") }).click();
    await expect.poll(() => page.locator("#nuvo-custom-css").count()).toBe(0);
    // the banner stays off Settings, whose reset row says the same
    const banner = page.locator("[role=status][data-nuvo-guard]");
    expect(await banner.count()).toBe(0);
    await page.keyboard.press("Escape");
    await banner.waitFor();
    await shoot("safe-mode");
    await banner.getByRole("button", { name: t("appearance.safe.turn_on") }).click();
    await banner.waitFor({ state: "detached" });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.preset ?? "")).toMatch(/^custom:/);
  });

  it("the same screens in dark and in Russian at 1100", { timeout: 900_000 }, async () => {
    const live = sessions[0];
    expect(live).toBeDefined();
    const page = live.page;
    const passes: Array<{ look: Look; size: Size; locale: Locale }> = [
      { look: { preset: "nuvo", mode: "dark" }, size: WIDE, locale: "en" },
      { look: { preset: "nuvo", mode: "light" }, size: NARROW, locale: "ru" },
    ];
    for (const { look, size, locale } of passes) {
      const t = (key: string, params?: Record<string, string>) => text(locale, key, params);
      const shoot = await prepare(live, look, size, locale);
      const editor = page.locator(`aside[aria-label="${t("appearance.editor.label")}"]`);

      await openSection(live, "appearance");
      await shoot("appearance");
      await page.getByRole("button", { name: t("appearance.theme.customize") }).click();
      await editor.waitFor();
      await editor.getByRole("button", { name: t("appearance.editor.edit_role", { role: t("appearance.roles.field.name") }) }).click();
      await page.getByLabel(t("appearance.picker.hex")).waitFor();
      await shoot("picker");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await editor.waitFor({ state: "detached" });
      await page.getByRole("button", { name: t("appearance.theme.discard") }).click();

      await page.locator(`button[aria-haspopup=listbox][aria-label^="${t("appearance.fonts.ui")}: "]`).click();
      await page.getByRole("listbox").waitFor();
      await shoot("font-list");
      await page.keyboard.press("Escape");
      await page.locator(`[role=dialog]`).getByText(t("appearance.fonts.files")).scrollIntoViewIfNeeded();
      await shoot("fonts");

      await openSection(live, "customization");
      await page.getByRole("button", { name: t("appearance.css.show"), exact: true }).click();
      await shoot("css");

      await page.getByRole("button", { name: t("appearance.safe.reset") }).click();
      const banner = page.locator("[role=status][data-nuvo-guard]");
      await page.keyboard.press("Escape");
      await banner.waitFor();
      await shoot("safe-mode");
      await banner.getByRole("button", { name: t("appearance.safe.turn_on") }).click();
      await banner.waitFor({ state: "detached" });
    }
  });
});
