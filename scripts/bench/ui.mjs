#!/usr/bin/env node
import fs from "node:fs";
import { close, createProfile, enableHandle, homeReady, launch, openPlaylist, option, seedProfile, sleep } from "./lib.mjs";
import { frameStats, summarize } from "./stats.mjs";

const exe = option("--exe");
const runs = Number(option("--runs", 5));
const STEP_PX = 800;
// digits only: rows of the seeded albums are "Album N" by "Artist M"
const QUERIES = ["4999", "1234", "777"];
const LIBRARY_ROWS = '[style*="translateY"] > [role="button"]';

function scrollPass(page) {
  return page.evaluate(async (step) => {
    let scroller = document.querySelector("[data-track-row]").parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== "visible"))
      scroller = scroller.parentElement;
    if (!scroller) throw new Error("no scroller");
    scroller.scrollTop = 0;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const gaps = [];
    let last = await frame();
    const go = async (top) => {
      scroller.scrollTop = top;
      const now = await frame();
      gaps.push(now - last);
      last = now;
    };
    const end = scroller.scrollHeight - scroller.clientHeight;
    for (let top = 0; top <= end; top += step) await go(top);
    for (let top = end; top >= 0; top -= step) await go(top);
    return { gaps, distance: end };
  }, STEP_PX);
}

function armKeystroke(page, needle) {
  return page.evaluate(
    ({ needle, rows }) => {
      // the result counts once the drawn rows changed, so rows that matched before the key do not end it early
      const signature = () => [...document.querySelectorAll(rows)].map((row) => row.textContent).join("|");
      const before = signature();
      window.__keystroke = new Promise((resolve) => {
        document.addEventListener(
          "keydown",
          () => {
            const t0 = performance.now();
            const check = () => {
              const drawn = [...document.querySelectorAll(rows)];
              if (drawn.length > 0 && signature() !== before && drawn.every((row) => row.textContent.toLowerCase().includes(needle)))
                resolve(performance.now() - t0);
              else if (performance.now() - t0 > 5_000) resolve(-1);
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          },
          { capture: true, once: true },
        );
      });
    },
    { needle, rows: LIBRARY_ROWS },
  );
}

const scrollRuns = [];
const keystrokes = [];
const perRunKeyP95 = [];
const profile = createProfile("ui");
try {
  await seedProfile(profile, exe, { data: true });
  for (let run = 0; run < runs; run++) {
    const { app, page } = await launch(profile, exe);
    try {
      await homeReady(page);
      await openPlaylist(page, profile.playlistId);
      await sleep(500);
      const { gaps, distance } = await scrollPass(page);
      const stats = frameStats(gaps);
      scrollRuns.push(stats);
      console.log(
        `run ${run + 1} scroll: ${stats.frames} frames over ${distance} px, p50 ${stats.p50} ms, p95 ${stats.p95} ms, worst ${stats.worst} ms, slow ${stats.slowShare * 100} %`,
      );

      await page.evaluate(() => (location.hash = "#/library"));
      const filter = page.getByRole("textbox").first();
      await page.locator('[style*="translateY"] > [role="button"]').first().waitFor({ timeout: 30_000 });
      const times = [];
      for (const query of QUERIES) {
        await filter.fill("");
        await sleep(500);
        await filter.focus();
        for (let i = 1; i <= query.length; i++) {
          await armKeystroke(page, query.slice(0, i));
          await page.keyboard.press(query[i - 1]);
          const ms = await page.evaluate(() => window.__keystroke);
          if (ms >= 0) times.push(ms);
          else console.log(`  keystroke "${query.slice(0, i)}" never showed its result`);
          await sleep(200);
        }
      }
      keystrokes.push(...times);
      perRunKeyP95.push(summarize(times, 1)?.p95);
      console.log(`run ${run + 1} filter: ${times.map((t) => Math.round(t)).join(", ")} ms`);
    } catch (error) {
      console.log(`run ${run + 1} failed: ${String(error).split("\n")[0]}`);
    }
    await close(app);
    await sleep(1_000);
  }
} finally {
  profile.remove();
}

const summary = {
  exe: exe ?? "dev",
  runs,
  playlistTracks: 5000,
  scrollFrameP95Ms: summarize(
    scrollRuns.map((s) => s.p95),
    2,
  ),
  scrollFrameP50Ms: summarize(
    scrollRuns.map((s) => s.p50),
    2,
  ),
  scrollSlowFrameShare: summarize(
    scrollRuns.map((s) => s.slowShare),
    4,
  ),
  filterKeystrokeMs: summarize(keystrokes, 1),
  filterRunP95Ms: summarize(perRunKeyP95.filter(Number.isFinite), 1),
  scrollRuns,
  keystrokes,
};
console.log(JSON.stringify({ ...summary, scrollRuns: undefined, keystrokes: undefined }, null, 2));
const out = option("--json");
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2));
