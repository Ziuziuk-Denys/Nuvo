import fs from "node:fs";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { isolate } from "../isolation";
import { passFirstRun } from "./harness";

const report = (line: string) => fs.appendFileSync(process.env.NUVO_STATS_PERF ?? "/dev/null", `${line}\n`);
const EVENTS = 200_000;
const TRACKS = 8000;
const DAY = 86_400_000;

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const profile = isolate("nuvo-stats-perf");
let app: ElectronApplication | null = null;

interface Live {
  page: Page;
  core(script: string): Promise<unknown>;
}

async function launch(): Promise<Live> {
  const running = await electron.launch({ args: [ROOT, `--user-data-dir=${profile.userData}`, "--mute-audio"], cwd: ROOT, env: profile.env });
  app = running;
  const deadline = Date.now() + 30_000;
  let page: Page | undefined;
  while (!page && Date.now() < deadline) {
    page = running.windows().find((win) => !win.url().includes("#/notch"));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error("main window did not appear");
  const main = page;
  await main.waitForLoadState("domcontentloaded");
  return {
    page: main,
    core: (script) => main.evaluate(`(async () => { const base = "nuvo-core://local"; const json = { "Content-Type": "application/json" }; ${script} })()`),
  };
}

async function quit(): Promise<void> {
  const running = app;
  app = null;
  await running?.close().catch(() => undefined);
}

afterAll(async () => {
  await quit();
  profile.dispose();
});

async function seed(live: Live): Promise<void> {
  const chunk = 2000;
  const now = Date.now();
  const step = (2000 * DAY) / EVENTS;
  for (let from = 0; from < EVENTS; from += chunk) {
    await live.core(`
      const now = ${now}, step = ${step}, from = ${from}, chunk = ${chunk}, tracks = ${TRACKS};
      const items = [];
      for (let index = from; index < from + chunk; index += 1) {
        const pick = Math.floor((Math.sin(index * 12.9898) * 43758.5453 % 1 + 1) % 1 * (Math.cos(index * 4.1414) * 91.17 % 1 + 1) % 1 * tracks);
        const id = "p" + String(pick).padStart(10, "0");
        const reason = index % 7 === 3 ? "skip" : index % 7 === 5 ? "next" : "complete";
        const at = Math.round(now - 2000 * 86400000 + index * step);
        items.push({
          listeningSessionId: "session-" + Math.floor(index / 12).toString(16).padStart(28, "0"),
          trackId: id,
          trackSnapshot: { id, title: "A fairly ordinary song title " + pick, artists: [{ id: "UCp" + (pick % 600), name: "Artist " + (pick % 600) }], album: { id: "MPREb" + (pick % 900), title: "Album " + (pick % 900) }, durationMs: 200000 },
          playedDurationMs: reason === "complete" ? 200000 : reason === "skip" ? 9000 : 60000,
          trackDurationMs: 200000, completed: reason === "complete", skipped: reason === "skip", loopCount: 0, endReason: reason,
          positionInSession: index % 12, startedAt: at, tzOffsetMin: new Date(at).getTimezoneOffset(), source: "youtube", context: { type: "radio", id: "p0" },
        });
      }
      for (let at = 0; at < items.length; at += 200) {
        await Promise.all(items.slice(at, at + 200).map((item) => fetch(base + "/v1/me/playback/events", { method: "POST", headers: json, body: JSON.stringify(item) })));
      }
    `);
  }
}

async function open(live: Live, range: string): Promise<number> {
  await live.page.evaluate(() => {
    location.hash = "#/";
  });
  await live.page.reload();
  await live.page.locator("[data-nav=stats]").waitFor({ timeout: 30_000 });
  // Home asks for its mixes after a reload; they hold the database for a moment at this size
  await live.page.waitForTimeout(4000);
  return live.page.evaluate(
    (value) =>
      new Promise<number>((resolve) => {
        const started = performance.now();
        location.hash = `#/stats?range=${value}`;
        const frame = () => {
          if (!document.querySelector("[data-testid=stats-lead]")) return requestAnimationFrame(frame);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
        };
        requestAnimationFrame(frame);
      }),
    range,
  );
}

describe.skipIf(!process.env.NUVO_STATS_PERF)("the Statistics page at 200 000 plays", () => {
  it("renders in time", { timeout: 1_500_000 }, async () => {
    const live = await launch();
    await passFirstRun(live.page);
    const started = Date.now();
    await seed(live);
    report(`seeded in ${Math.round((Date.now() - started) / 1000)} s`);
    await quit();

    const fresh = await launch();
    await fresh.page.locator("[data-nav=stats]").waitFor({ timeout: 30_000 });
    await fresh.page.waitForTimeout(12_000);
    const first = await open(fresh, "month");
    report(`first opening after a restart ${Math.round(first)} ms`);
    const count = (await fresh.core(`return (await (await fetch(base + "/v1/stats/overview")).json()).totals.plays;`)) as number;
    report(`plays ${count}`);
    expect(count).toBeGreaterThan(100_000);
    for (const range of ["week", "month", "year", "all"]) {
      const runs = [await open(fresh, range), await open(fresh, range), await open(fresh, range)];
      report(`${range}: page ${runs.map((ms) => Math.round(ms)).join(", ")} ms`);
      expect(runs.sort((a, b) => a - b)[1]).toBeLessThan(150);
    }
  });
});
