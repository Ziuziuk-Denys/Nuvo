import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { clearKeyring, launchNuvo, SIZES, type Look, type NuvoSession, type Size } from "./harness";

const STEP = "7-states";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ARTIFACTS = path.join(ROOT, "e2e", "artifacts", "ui", STEP);
// the daemon binary of this checkout only, so a parallel run's daemon is never touched
const CORE_BINARY = path.join(ROOT, "core", "target", "debug", "nuvo-core");

interface Locale {
  locale: "en" | "ru";
  looks: Look[];
  sizes: Size[];
  text: Record<
    "confirm" | "skipTour" | "ok" | "liked" | "starting" | "retrying" | "failed" | "offline" | "locked" | "unlock" | "lost" | "errorTitle" | "details",
    string
  >;
  toast: { liked: string; undo: string; importing: string; progress: string };
}

const EN: Locale = {
  locale: "en",
  looks: [
    { preset: "nuvo", mode: "light" },
    { preset: "nuvo", mode: "dark" },
  ],
  sizes: [SIZES[0]],
  text: {
    confirm: "I wrote it down",
    skipTour: "Skip the tour",
    ok: "Got it",
    liked: "Liked songs",
    starting: "Opening your library",
    retrying: "Reconnecting to your library",
    failed: "Your library stopped",
    offline: "You're offline",
    locked: "Unlock your library",
    unlock: "Unlock",
    lost: "Lost the phrase?",
    errorTitle: "Something went wrong",
    details: "Details",
  },
  toast: { liked: "Added to Liked songs", undo: "Undo", importing: "Matching tracks", progress: "Matched 12 of 40 tracks" },
};

const RU: Locale = {
  locale: "ru",
  looks: [{ preset: "nuvo", mode: "light" }],
  sizes: [SIZES[1]],
  text: {
    confirm: "Записано",
    skipTour: "Пропустить тур",
    ok: "Понятно",
    liked: "Любимые треки",
    starting: "Открываем медиатеку",
    retrying: "Переподключаемся к медиатеке",
    failed: "Медиатека остановилась",
    offline: "Нет сети",
    locked: "Откройте медиатеку",
    unlock: "Открыть",
    lost: "Потеряли фразу?",
    errorTitle: "Что-то пошло не так",
    details: "Подробности",
  },
  toast: { liked: "Добавлено в Любимые", undo: "Отменить", importing: "Сопоставление треков", progress: "Найдено 12 из 40 треков" },
};

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

function heading(page: Page, text: string) {
  return page.getByRole("heading", { name: text, exact: true });
}

/** Kills this checkout's daemon; core-host restarts it after its back-off. */
function killCore(): void {
  try {
    execFileSync("pkill", ["-KILL", "-f", CORE_BINARY]);
  } catch {
    // not running at this moment
  }
}

function coreRunning(): boolean {
  try {
    execFileSync("pgrep", ["-f", CORE_BINARY]);
    return true;
  } catch {
    return false;
  }
}

async function shootNow(page: Page, name: string): Promise<void> {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

async function showToasts(page: Page, l: Locale, kind: "action" | "loader"): Promise<void> {
  // the toaster listens once the app has mounted
  await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  await page.evaluate(
    ({ toast, kind }) => {
      const detail =
        kind === "action"
          ? { message: toast.liked, variant: "success", options: { duration: 60_000, action: { label: toast.undo, onClick: () => undefined } } }
          : { message: toast.importing, variant: "loader", options: { description: toast.progress } };
      window.dispatchEvent(new CustomEvent("nuvo:toast", { detail }));
    },
    { toast: l.toast, kind },
  );
  await page.locator("[data-toast]").first().waitFor({ timeout: 5_000 });
}

async function run(l: Locale): Promise<void> {
  // a failed earlier run leaves its session open
  await session?.close();
  session = await launchNuvo({ profile: "fresh", locale: l.locale });
  const live = session;
  const page = live.page;
  // the harness reloads only when the look changes, so every state starts from a reload of its own
  const shoot = (screen: string, state: string, prepare: () => Promise<void>) =>
    live.shoot(STEP, screen, state, {
      looks: l.looks,
      sizes: l.sizes,
      prepare: async () => {
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await prepare();
        // the cards and capsules rise in; shoot them at rest
        await page.waitForTimeout(700);
      },
    });

  // the first run: the phrase until it is confirmed, then the tour's start step over the pages; a reload brings either back
  await shoot("firstrun", "phrase", async () => {
    await page.locator("[data-testid=recovery-word]").first().waitFor({ timeout: 30_000 });
  });
  expect(await page.locator("[data-testid=recovery-word]").count()).toBe(24);
  // kept to unlock for real once the key is gone
  const words = await page.locator("[data-testid=recovery-word] > span:nth-child(2)").allTextContents();
  expect(words).toHaveLength(24);
  await page.getByRole("button", { name: l.text.confirm }).click();
  await shoot("firstrun", "start", async () => {
    await page.locator("#tour-start-title").waitFor({ timeout: 30_000 });
  });
  await page.getByRole("button", { name: l.text.skipTour, exact: true }).click();
  await page.getByRole("button", { name: l.text.ok, exact: true }).and(page.locator(':not([aria-disabled="true"])')).click({ timeout: 30_000 });
  await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  // a finished first run stays finished across a reload
  await page.reload();
  await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  expect(await heading(page, "Nuvo").count()).toBe(0);

  await shoot("toast", "action", () => showToasts(page, l, "action"));
  await shoot("toast", "loader", () => showToasts(page, l, "loader"));

  // a start that drags on: main tells the window the daemon is starting again
  const sendStatus = (status: string) =>
    live.app.evaluate(({ BrowserWindow }, value) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send("core:status", value);
    }, status);
  await shoot("status", "starting", async () => {
    await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
    await sendStatus("starting");
    await page.getByText(l.text.starting).waitFor({ timeout: 5_000 });
  });
  await sendStatus("ready");
  await page.getByText(l.text.starting).waitFor({ state: "detached", timeout: 5_000 });

  // offline: once per page session, so every reload shows it again
  await page.context().setOffline(true);
  await shoot("status", "offline", async () => {
    await page.getByText(l.text.offline).waitFor({ timeout: 15_000 });
  });
  await page.context().setOffline(false);

  // the daemon line while it restarts
  for (const look of l.looks) {
    await live.setLook(look);
    await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    killCore();
    await page.getByText(l.text.retrying).waitFor({ timeout: 5_000 });
    // the card springs in; shoot it at rest
    await page.waitForTimeout(700);
    await shootNow(page, `status-retrying-${look.preset}-${look.mode}-${l.sizes[0].width}`);
    await page.getByText(l.text.retrying).waitFor({ state: "detached", timeout: 30_000 });
    // the restarted daemon serves the library again: the empty library's welcome needs its answer
    await live.go("#/library");
    await page.locator('[data-tour="library-import"]').waitFor({ timeout: 30_000 });
    await live.go("#/");
  }

  // the lock screen: without its key the restarted daemon opens locked
  clearKeyring();
  killCore();
  await heading(page, l.text.locked).waitFor({ timeout: 60_000 });
  await shoot("lock", "empty", async () => {
    await heading(page, l.text.locked).waitFor({ timeout: 30_000 });
  });
  // the card takes focus, so the phrase can be typed at once
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
  await shoot("lock", "lost", async () => {
    await heading(page, l.text.locked).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: l.text.lost }).click();
  });
  const wrong = Array.from({ length: 24 }, () => "abandon").join(" ");
  await shoot("lock", "wrong", async () => {
    await heading(page, l.text.locked).waitFor({ timeout: 30_000 });
    await page.locator("textarea").fill(wrong);
    await page.getByRole("button", { name: l.text.unlock, exact: true }).click();
    await page.getByRole("alert").waitFor({ timeout: 15_000 });
  });
  // reduced motion: the wrong phrase is told without the shake
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await heading(page, l.text.locked).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.locator("textarea").fill(wrong);
  await page.keyboard.press("Enter");
  await page.getByRole("alert").waitFor({ timeout: 15_000 });
  // a finished entrance keeps its fill, so only a running animation would be the shake
  expect(await page.getByRole("dialog").evaluate((card) => card.getAnimations().filter((item) => item.playState === "running").length)).toBe(0);
  await page.emulateMedia({ reducedMotion: null });
  // the real phrase from the first run opens the library again, by keyboard
  await page.locator("textarea").fill(words.join(" "));
  await page.keyboard.press("Enter");
  // the rail stays mounted under the card, so wait for the card itself to leave
  await heading(page, l.text.locked).waitFor({ state: "detached", timeout: 30_000 });
  await expect.poll(() => page.getByRole("dialog").count(), { timeout: 10_000 }).toBe(0);

  // the daemon gives up after repeated crashes
  for (let attempt = 0; attempt < 8 && (await page.getByText(l.text.failed).count()) === 0; attempt += 1) {
    const deadline = Date.now() + 15_000;
    while (!coreRunning() && Date.now() < deadline) await page.waitForTimeout(200);
    killCore();
    await page.waitForTimeout(1_000);
  }
  await shoot("status", "failed", async () => {
    await page.getByText(l.text.failed).waitFor({ timeout: 15_000 });
  });

  // the error screen through the test-only crash key
  await shoot("error", "screen", async () => {
    await page.evaluate(() => sessionStorage.setItem("nuvo_e2e_throw", "1"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await heading(page, l.text.errorTitle).waitFor({ timeout: 30_000 });
    // the screen stays until the next reload, which must load the app again
    await page.evaluate(() => sessionStorage.removeItem("nuvo_e2e_throw"));
  });
  await shoot("error", "details", async () => {
    await page.evaluate(() => sessionStorage.setItem("nuvo_e2e_throw", "1"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await heading(page, l.text.errorTitle).waitFor({ timeout: 30_000 });
    await page.evaluate(() => sessionStorage.removeItem("nuvo_e2e_throw"));
    // Reload holds the focus, so the details open from the keyboard
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.getByText("Component stack").waitFor({ timeout: 5_000 });
  });

  await live.close();
  session = null;
}

describe("states", () => {
  it("first run, toasts, offline, daemon lines, the lock card and the error card in light and dark", () => run(EN), 600_000);
  it("the same in Russian at 1100", () => run(RU), 600_000);
});
