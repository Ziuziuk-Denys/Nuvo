#!/usr/bin/env node
import fs from "node:fs";
import { close, createProfile, enableHandle, homeReady, launch, openPlaylist, option, putTone, seedProfile, sleep } from "./lib.mjs";
import { summarize } from "./stats.mjs";

const exe = option("--exe");
const runs = Number(option("--runs", 5));
const live = process.env.NUVO_BENCH_LIVE === "1";
const thinkMs = Number(option("--think", 1500));
const prepare = !process.argv.includes("--no-prepare");
const WARM_ROWS = 4;
const QUERIES = [
  "Queen Bohemian Rhapsody",
  "Daft Punk Get Lucky",
  "Adele Hello",
  "Radiohead Creep",
  "Nirvana Smells Like Teen Spirit",
  "Massive Attack Teardrop",
  "Billie Eilish Lovely",
  "Kino Gruppa krovi",
  "The Weeknd Blinding Lights",
  "Portishead Glory Box",
];

function arm(page) {
  return page.evaluate(() => {
    const state = { clickAt: 0, loadAt: 0, playingAt: 0, audioAt: 0 };
    window.__bench = state;
    document.addEventListener("dblclick", () => (state.clickAt ||= performance.now()), { capture: true, once: true });
    const handle = window.__nuvoPlayer;
    const load = handle.decks.load;
    handle.decks.load = function (...args) {
      if (state.clickAt && !state.loadAt) {
        state.loadAt = performance.now();
        state.kind = args[0].source.kind;
        state.trackId = args[0].trackId;
      }
      return load.apply(this, args);
    };
    const stop = handle.decks.on((event) => {
      if (state.clickAt && event.type === "playing") state.playingAt ||= performance.now();
    });
    const poll = () => {
      if (state.clickAt && handle.engine.getView().status === "playing" && handle.decks.clock.positionMs() > 0) {
        state.audioAt = performance.now();
        stop();
      } else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

async function measure(page, row) {
  await arm(page);
  await row.dblclick();
  const done = await page.waitForFunction(() => window.__bench.audioAt && window.__bench, null, { timeout: 30_000 });
  const { clickAt, audioAt, playingAt, loadAt, kind, trackId } = await done.jsonValue();
  await page.evaluate(() => {
    delete window.__nuvoPlayer.decks.load;
    window.__nuvoPlayer.engine.pause();
  });
  return { audioMs: audioAt - clickAt, playingMs: playingAt - clickAt, resolveMs: loadAt - clickAt, kind, trackId };
}

const results = { cold: [], warm: [], liveNetwork: [], liveReplay: [], failures: [] };
const profile = createProfile("latency");
try {
  await seedProfile(profile, exe, { data: true });
  for (let run = 0; run < runs; run++) {
    const { app, page } = await launch(profile, exe);
    try {
      await enableHandle(page);
      await homeReady(page);
      for (let row = 0; row <= WARM_ROWS; row++) await putTone(page, `bench-${String(row).padStart(4, "0")}`, 10, 8_000);
      await openPlaylist(page, profile.playlistId);
      for (let row = 0; row <= WARM_ROWS; row++) {
        const sample = await measure(page, page.locator("[data-track-row]").nth(row));
        (row === 0 ? results.cold : results.warm).push(sample);
        console.log(`run ${run + 1} row ${row}: audio ${Math.round(sample.audioMs)} ms, playing ${Math.round(sample.playingMs)} ms`);
        await sleep(300);
      }
      if (live && run === 0) await liveRun(page);
    } catch (error) {
      results.failures.push({ run, error: String(error).split("\n")[0] });
      console.log(`run ${run + 1} failed: ${String(error).split("\n")[0]}`);
    }
    await close(app);
    await sleep(1_000);
  }
} finally {
  profile.remove();
}

// shortcut: unverified offline, selectors follow the Search page rows (variant track, duration at the end)
async function liveRun(page) {
  if (!prepare) await page.evaluate(() => (window.__nuvoPlayer.engine.prepareStarts = () => undefined));
  await page.evaluate(() => (location.hash = "#/search"));
  const input = page.getByRole("textbox").first();
  for (const pass of ["liveNetwork", "liveReplay"]) {
    for (const query of QUERIES) {
      try {
        const row = page
          .locator('[role="button"]')
          .filter({ hasText: /\d:\d\d$/ })
          .first();
        const before = (await row.count()) ? await row.innerText() : null;
        await input.fill(query);
        await row.waitFor({ timeout: 20_000 });
        await page.waitForFunction(
          (before) => [...document.querySelectorAll('[role="button"]')].find((el) => /\d:\d\d$/.test(el.innerText))?.innerText !== before,
          before,
          { timeout: 20_000 },
        );
        await sleep(thinkMs);
        const sample = await measure(page, row);
        results[pass].push(sample);
        console.log(`${pass} ${query}: audio ${Math.round(sample.audioMs)} ms, resolve ${Math.round(sample.resolveMs)} ms, ${sample.kind} ${sample.trackId}`);
      } catch (error) {
        results.failures.push({ pass, query, error: String(error).split("\n")[0] });
      }
      await sleep(1_000);
    }
  }
}

const both = (samples) => ({
  audioMs: summarize(
    samples.map((s) => s.audioMs),
    0,
  ),
  playingMs: summarize(
    samples.map((s) => s.playingMs),
    0,
  ),
  resolveMs: summarize(
    samples.map((s) => s.resolveMs),
    0,
  ),
});
const summary = {
  exe: exe ?? "dev",
  runs,
  cachedFirstStart: both(results.cold),
  cachedLaterStarts: both(results.warm),
  uncached: live ? { network: both(results.liveNetwork), replay: both(results.liveReplay) } : "skipped (set NUVO_BENCH_LIVE=1, needs network)",
  failures: results.failures,
  raw: results,
};
console.log(JSON.stringify({ ...summary, raw: undefined }, null, 2));
const out = option("--json");
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2));
