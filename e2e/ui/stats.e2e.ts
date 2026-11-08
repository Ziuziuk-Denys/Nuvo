import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, type Look, type NuvoSession } from "./harness";
import { fixtureCover } from "./seed";

/** The Statistics page in the real app: empty, the first hour, a seeded history, drill-downs, export, delete and the pause switch. */
const SHOTS = process.env.NUVO_STATS_SHOTS ?? path.join(os.homedir(), ".cache", "stats-shots");
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };
const W1200 = { width: 1200, height: 780 };
const W1100 = { width: 1100, height: 705 };
const W1600 = { width: 1600, height: 1000 };

let session: NuvoSession | null = null;
let exportsDir = "";

const ARTISTS = [
  "Northern Lights",
  "Velvet Hour",
  "Paper Satellites",
  "Дорожный патруль",
  "Ночные снайперы",
  "Glass Harbor",
  "Мурашки",
  "Static Garden",
  "Slow Parade",
  "Белые крылья",
  "Golden Radio",
  "Echo Season",
];
const WORDS = ["Midnight", "Glass", "Harbor", "Static", "Golden", "Echo", "Neon", "Paper", "Orbit", "Slow", "Summer", "Signal"];
const NOUNS = ["Drive", "Tide", "Garden", "Letters", "Window", "Season", "Parade", "Radio", "Skyline", "Fever"];

interface Seeded {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId: string;
  cover: string;
  durationMs: number;
}

function catalog(): Seeded[] {
  return Array.from({ length: 96 }, (_, index) => {
    const artist = ARTISTS[index % ARTISTS.length];
    return {
      id: `e2eStat${String(index).padStart(4, "0")}`,
      title: `${WORDS[index % WORDS.length]} ${NOUNS[(index * 7) % NOUNS.length]}`,
      artist,
      album: `${WORDS[(index + 3) % WORDS.length]} Sessions`,
      albumId: `MPREb_stat${index % 24}`,
      artistId: `UCstat${index % ARTISTS.length}`,
      cover: fixtureCover(index),
      durationMs: 150_000 + ((index * 7919) % 150_000),
    };
  });
}

/** Posts plays through the daemon's own route: the same path the player uses. */
async function post(live: NuvoSession, plays: unknown[]): Promise<void> {
  const chunk = 400;
  for (let at = 0; at < plays.length; at += chunk) {
    const body = JSON.stringify(plays.slice(at, at + chunk));
    const failed = await live.core(`
      const items = ${body};
      const answers = await Promise.all(items.map((item) => fetch(base + "/v1/me/playback/events", { method: "POST", headers: json, body: JSON.stringify(item) })));
      return answers.filter((answer) => !answer.ok).length;
    `);
    expect(failed).toBe(0);
  }
}

function play(
  track: Seeded,
  at: number,
  session_: string,
  position: number,
  played: number,
  reason: string,
  context: { type: string; id?: string } | null,
  source: string,
  loops = 0,
) {
  return {
    listeningSessionId: session_,
    trackId: track.id,
    trackSnapshot: {
      id: track.id,
      title: track.title,
      artists: [{ id: track.artistId, name: track.artist }],
      album: { id: track.albumId, title: track.album },
      cover: { url: track.cover, width: 512, height: 512 },
      durationMs: track.durationMs,
    },
    playedDurationMs: played,
    trackDurationMs: track.durationMs,
    completed: reason === "complete",
    skipped: reason === "skip",
    loopCount: loops,
    endReason: reason,
    positionInSession: position,
    startedAt: at,
    tzOffsetMin: new Date(at).getTimezoneOffset(),
    source,
    ...(context ? { context } : {}),
  };
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Two years of evenings, weekend afternoons and a few favourites, with gaps and a fading old love. */
function history(days: number, sessionsPerDay = 1.3): unknown[] {
  const tracks = catalog();
  const next = random(7);
  const plays: unknown[] = [];
  const now = Date.now();
  const contexts: ({ type: string; id?: string } | null)[] = [
    { type: "playlist", id: "likes" },
    { type: "playlist", id: "likes" },
    { type: "album", id: "MPREb_stat3" },
    { type: "radio", id: "e2eStat0001" },
    { type: "continue", id: "likes" },
    { type: "search" },
    { type: "artist", id: "UCstat2" },
    { type: "mix", id: "for-you" },
  ];
  for (let back = days; back >= 0; back -= 1) {
    const day = new Date(now - back * 86_400_000);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    if (next() < 0.14) continue;
    const sessions = Math.round(next() * sessionsPerDay * 2) + (weekend ? 1 : 0);
    for (let s = 0; s < sessions; s += 1) {
      const hour = weekend ? 11 + Math.floor(next() * 12) : next() < 0.25 ? 8 : 18 + Math.floor(next() * 5);
      const start = new Date(day);
      start.setHours(hour, Math.floor(next() * 60), 0, 0);
      let at = start.getTime();
      if (at > now - 3_600_000) continue;
      const context = contexts[Math.floor(next() * contexts.length)];
      const length = 4 + Math.floor(next() * 14);
      const id = `seed-${back}-${s}`;
      const source = next() < 0.7 ? "youtube" : next() < 0.8 ? "soundcloud" : "cache";
      for (let position = 1; position <= length; position += 1) {
        // favourites stay near the top; the old loves (40 to 43) end two hundred days ago
        const favourite = next() < 0.35 ? Math.floor(next() * next() * 14) : Math.floor(next() * tracks.length);
        const old = 40 + Math.floor(next() * 4);
        const picked = back > 200 && next() < 0.1 ? old : favourite >= 40 && favourite < 44 ? favourite + 4 : favourite;
        // the newest songs arrive in the last two months
        const track = tracks[picked >= 88 && back > 60 ? picked - 40 : picked];
        const roll = next();
        const reason = roll < 0.74 ? "complete" : roll < 0.9 ? "skip" : "next";
        const played = reason === "complete" ? track.durationMs : reason === "skip" ? 4000 + Math.floor(next() * 24_000) : 40_000 + Math.floor(next() * 90_000);
        plays.push(play(track, at, id, position, played, reason, context, source, roll < 0.02 ? 2 : 0));
        at += played + 1500;
      }
    }
  }
  return plays;
}

async function shot(live: NuvoSession, name: string, size: { width: number; height: number }, full = false): Promise<void> {
  await live.setSize(size);
  await live.page.emulateMedia({ reducedMotion: "reduce" });
  await live.page.waitForTimeout(700);
  if (!full) {
    await live.page.screenshot({ path: path.join(SHOTS, `${name}-${size.width}.png`) });
    return;
  }
  // the page scrolls inside the shell, so the whole of it is read off by stretching the window
  const height = await live.page.evaluate(
    () => (document.querySelector("[data-testid=stats-page],[data-testid=stats-track],[data-testid=stats-artist]") as HTMLElement).scrollHeight,
  );
  await live.setSize({ width: size.width, height: Math.min(height + 220, 4200) });
  await live.page.waitForTimeout(500);
  await live.page.screenshot({ path: path.join(SHOTS, `${name}-${size.width}-full.png`) });
  await live.setSize(size);
}

const openStats = async (live: NuvoSession, range = "month"): Promise<void> => {
  await live.go(`#/stats?range=${range}`);
  await live.page.locator("[data-testid=stats-page]").waitFor({ timeout: 15_000 });
  await live.page.waitForTimeout(400);
};

const toToday = async (live: NuvoSession) => live.page.evaluate(() => new Date().getTimezoneOffset());

beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-stats-export-"));
  session = await launchNuvo({ profile: "fresh" });
  await passFirstRun(session.page);
  await session.setLook(LIGHT);
});

afterAll(async () => {
  await session?.close();
  fs.rmSync(exportsDir, { recursive: true, force: true });
});

describe("the Statistics page", () => {
  it("opens from the rail and invites a first play on a new profile", async () => {
    const live = session!;
    await live.page.locator("[data-nav=stats]").click();
    await expect.poll(() => live.page.locator("[data-testid=stats-empty]").count(), { timeout: 15_000 }).toBe(1);
    expect(await live.page.locator("[data-stats-section]").count()).toBe(0);
    await shot(live, "empty-light", W1200);
  });

  it("is useful after the first hour", async () => {
    const live = session!;
    const tracks = catalog();
    const now = Date.now();
    const start = now - 3_600_000;
    let at = start;
    const plays = Array.from({ length: 14 }, (_, index) => {
      const track = tracks[index % 5];
      const reason = index % 4 === 3 ? "skip" : "complete";
      const played = reason === "complete" ? track.durationMs : 9000;
      const body = play(track, at, "first-hour", index + 1, played, reason, { type: "playlist", id: "likes" }, "youtube");
      at += played;
      return body;
    });
    await post(live, plays);
    await openStats(live, "week");
    await live.page.reload();
    await live.page.locator("[data-testid=stats-lead]").waitFor({ timeout: 15_000 });
    await expect.poll(() => live.page.locator("[data-testid=stats-growing]").count()).toBe(1);
    // nothing with too little to show
    expect(await live.page.locator("[data-stats-section=calendar]").count()).toBe(0);
    expect(await live.page.locator("[data-stats-section=rhythm]").count()).toBe(0);
    expect(await live.page.locator("[data-stats-row]").count()).toBeGreaterThan(3);
    await shot(live, "sparse-light", W1200, true);
    await live.setLook(DARK);
    await openStats(live, "week");
    await shot(live, "sparse-dark", W1200, true);
    await live.setLook(LIGHT);
  });

  it("tells a full history with every section", async () => {
    const live = session!;
    await post(live, history(720));
    await openStats(live, "year");
    await live.page.reload();
    await live.page.locator("[data-testid=stats-lead]").waitFor({ timeout: 15_000 });
    for (const section of ["rhythm", "calendar", "hours", "weekdays", "top", "habits", "on-repeat", "discoveries", "replayed", "skipped", "forgotten"]) {
      await expect.poll(() => live.page.locator(`[data-stats-section=${section}]`).count(), { timeout: 10_000 }).toBe(1);
    }
    expect(await live.page.locator("[data-stats-section=top] [data-stats-row]").count()).toBe(10);
    await shot(live, "year-light", W1200);
    await shot(live, "year-light", W1200, true);
    await shot(live, "year-light", W1100, true);
    await shot(live, "year-light", W1600, true);
  });

  it("switches range and compares with the period before", async () => {
    const live = session!;
    await live.page.getByRole("tab", { name: "Week", exact: true }).click();
    await expect.poll(() => live.page.url()).toContain("range=week");
    await expect.poll(() => live.page.getByText(/in the last 7 days/).count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await shot(live, "week-light", W1200, true);
    await live.page.getByRole("tab", { name: "All time", exact: true }).click();
    await expect.poll(() => live.page.getByText(/since/).count(), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await live.page.getByText(/vs the period before/).count()).toBe(0);
    await shot(live, "all-light", W1200, true);
    await live.page.getByRole("tab", { name: "Custom", exact: true }).click();
    const today = new Date();
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    await live.page
      .locator("input[type=date]")
      .first()
      .fill(iso(new Date(today.getTime() - 40 * 86_400_000)));
    await live.page
      .locator("input[type=date]")
      .nth(1)
      .fill(iso(new Date(today.getTime() - 10 * 86_400_000)));
    await live.page.getByRole("button", { name: "Show", exact: true }).click();
    await expect.poll(() => live.page.url()).toContain("range=custom");
    await expect.poll(() => live.page.getByText(/listened from/).count(), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  it("shows the same page in dark and in the theme presets", async () => {
    const live = session!;
    await live.setLook(DARK);
    await openStats(live, "year");
    await shot(live, "year-dark", W1200);
    await shot(live, "year-dark", W1200, true);
    for (const preset of ["orbit", "vinyl", "editor", "sunset"] as const) {
      await live.setLook({ preset, mode: preset === "editor" || preset === "sunset" ? "light" : "dark" });
      await openStats(live, "year");
      await shot(live, `year-${preset}`, W1200);
    }
    await live.setLook(LIGHT);
  });

  it("opens a song's history from its menu (a click on a song plays it) and an artist's from its row", async () => {
    const live = session!;
    await openStats(live, "year");
    await live.page.locator("[data-stats-section=top] [data-stats-row]").first().click({ button: "right" });
    await live.page.getByRole("menuitem", { name: "Listening statistics" }).click();
    await live.page.locator("[data-testid=stats-track]").waitFor({ timeout: 15_000 });
    await expect.poll(() => live.page.getByText(/First heard/).count(), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => live.page.locator("[data-stats-section=months]").count()).toBe(1);
    await live.page.locator("[data-testid=stats-track]").getByRole("button", { name: "More", exact: true }).click();
    await expect.poll(() => live.page.getByRole("menuitem", { name: "Add to queue" }).count()).toBe(1);
    await live.page.keyboard.press("Escape");
    await shot(live, "track-light", W1200, true);
    await live.setLook(DARK);
    await live.page.waitForTimeout(400);
    await live.page.locator("[data-testid=stats-track]").waitFor({ timeout: 15_000 });
    await shot(live, "track-dark", W1200, true);
    await live.setLook(LIGHT);

    await openStats(live, "year");
    await live.page.getByRole("tab", { name: "Artists", exact: true }).click();
    await live.page.locator("[data-stats-section=top] [data-stats-row]").first().locator('[role="button"]').first().click();
    await live.page.locator("[data-testid=stats-artist]").waitFor({ timeout: 15_000 });
    await expect.poll(() => live.page.locator("[data-stats-section=artist-top] [data-stats-row]").count(), { timeout: 10_000 }).toBeGreaterThan(1);
    await shot(live, "artist-light", W1200, true);
  });

  it("shows Russian with its own plurals and dates at 1100", async () => {
    const live = session!;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await openStats(live, "year");
    await expect.poll(() => live.page.getByText(/музыки за последние 12 месяцев/).count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await shot(live, "year-ru-light", W1100, true);
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));
    await live.page.reload();
    await openStats(live, "year");
  });

  it("exports the period as JSON and CSV through the save dialog", async () => {
    const live = session!;
    const target = path.join(exportsDir, "listening");
    await live.app.evaluate(({ dialog }, base) => {
      let next = 0;
      dialog.showSaveDialog = (async () => {
        next += 1;
        return { canceled: false, filePath: `${base}-${next}` };
      }) as typeof dialog.showSaveDialog;
    }, target);
    await live.page.getByRole("button", { name: "Export and delete", exact: true }).click();
    await live.page.getByRole("menuitem", { name: "Export as JSON" }).click();
    await expect.poll(() => fs.existsSync(`${target}-1`), { timeout: 15_000 }).toBe(true);
    const document = JSON.parse(fs.readFileSync(`${target}-1`, "utf8")) as { kind: string; events: { trackId: string; playedMs: number }[] };
    expect(document.kind).toBe("nuvo-listening");
    expect(document.events.length).toBeGreaterThan(100);
    await live.page.getByRole("button", { name: "Export and delete", exact: true }).click();
    await live.page.getByRole("menuitem", { name: "Export as CSV" }).click();
    await expect.poll(() => fs.existsSync(`${target}-2`), { timeout: 15_000 }).toBe(true);
    const lines = fs.readFileSync(`${target}-2`, "utf8").trim().split("\r\n");
    expect(lines[0].startsWith("played_at,local_date,track_id")).toBe(true);
    expect(lines.length - 1).toBe(document.events.length);
  });

  it("stores nothing while paused", async () => {
    const live = session!;
    await live.core(`await fetch(base + "/v1/stats/collection", { method: "PUT", headers: json, body: JSON.stringify({ paused: true }) });`);
    await live.page.reload();
    await openStats(live, "week");
    await expect.poll(() => live.page.locator("[data-testid=stats-paused]").count(), { timeout: 10_000 }).toBe(1);
    const before = (await live.core(`return (await (await fetch(base + "/v1/stats/overview")).json()).totals.plays;`)) as number;
    await post(live, [play(catalog()[0], Date.now() - 1000, "paused", 1, 100_000, "complete", null, "youtube")]);
    expect(await live.core(`return (await (await fetch(base + "/v1/stats/overview")).json()).totals.plays;`)).toBe(before);
    await shot(live, "paused-light", W1200);
    await live.page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect.poll(() => live.page.locator("[data-testid=stats-paused]").count(), { timeout: 10_000 }).toBe(0);
  });

  it("deletes a period and then everything, and recommendations keep answering", async () => {
    const live = session!;
    await openStats(live, "week");
    const count = () => live.core(`return (await (await fetch(base + "/v1/stats/overview")).json()).totals.plays;`) as Promise<number>;
    const before = await count();
    const rows = (from: string) =>
      live.core(`return (await (await fetch(base + "/v1/stats/overview?from=${from}&to=${from}")).json()).totals.plays;`) as Promise<number>;
    await live.page.getByRole("button", { name: "Export and delete", exact: true }).click();
    await live.page.getByRole("menuitem", { name: "Delete this period" }).click();
    await shot(live, "delete-sheet-light", W1200);
    await live.page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => live.page.locator("[data-testid=stats-silent]").count(), { timeout: 15_000 }).toBe(1);
    await shot(live, "silent-light", W1200);
    const after = await count();
    expect(after).toBeLessThan(before);
    const today = await live.page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    expect(await rows(today)).toBe(0);

    await live.page.getByRole("button", { name: "Export and delete", exact: true }).click();
    await live.page.getByRole("menuitem", { name: "Delete all statistics" }).click();
    await live.page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => live.page.locator("[data-testid=stats-empty]").count(), { timeout: 15_000 }).toBe(1);
    expect(await count()).toBe(0);
    expect(await live.core(`return (await (await fetch(base + "/v1/me/history")).json()).items.length;`)).toBe(0);
    expect(await live.core(`return (await fetch(base + "/v1/me/recommendations/daily-mixes")).status;`)).toBe(200);
    expect(await toToday(live)).toBeTypeOf("number");
  });
});
