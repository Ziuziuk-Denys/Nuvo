#!/usr/bin/env node
// Music folders at scale: a 20,000-file synthetic folder is added while a local track plays.
// Measures the scan, a rescan after touching 100 files, the daemon's RSS and CPU, playback
// steadiness during the scan, the Library tab's scroll and the search latency over 20,000 files.
// The daemon is the binary at core/target/debug/nuvo-core (point it at a release build for release numbers).
// usage: node scripts/bench/local.mjs [--fixture ~/.cache/nuvo-20k] [--json out.json]
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { close, createProfile, enableHandle, launch, option, processTree, seedProfile, sleep } from "./lib.mjs";
import { makeFixture } from "./local-fixture.mjs";
import { frameStats, parseStat, percentile, round, summarize, toneWav } from "./stats.mjs";

const fixture = path.resolve(option("--fixture", path.join(os.homedir(), ".cache", "nuvo-20k")));
const playDir = `${fixture}-play`;
const EXPECTED = 20_000 + 40;
if (!fs.existsSync(path.join(fixture, "broken"))) makeFixture(fixture);
fs.rmSync(playDir, { recursive: true, force: true });
fs.mkdirSync(playDir, { recursive: true });
fs.writeFileSync(path.join(playDir, "Bench Band - Long Tone.wav"), toneWav(300, 16_000));

const corePid = (root) =>
  processTree(root).find((pid) => {
    try {
      return path.basename(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0]) === "nuvo-core";
    } catch {
      return false;
    }
  });
const rssMb = (pid) => Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+) kB/m)[1]) / 1024;
const peakMb = (pid) => Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmHWM:\s+(\d+) kB/m)[1]) / 1024;
const ticks = (pid) => parseStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8")).ticks;

async function pick(app, folder) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] });
  }, folder);
}
const status = (page) => page.evaluate(() => fetch("nuvo-core://local/v1/local/status").then((r) => r.json()));

// samples the daemon every 100 ms while `until` has not resolved
async function watchDaemon(pid, until) {
  const samples = [];
  let done = false;
  until.then(() => (done = true));
  let last = ticks(pid);
  while (!done) {
    await sleep(100);
    const now = ticks(pid);
    samples.push({ cpu: (now - last) * 10, rss: rssMb(pid) });
    last = now;
  }
  return {
    avgCpu: round(samples.reduce((s, x) => s + x.cpu, 0) / samples.length, 1),
    peakCpu: round(Math.max(...samples.map((s) => s.cpu)), 1),
    peakRssMb: round(peakMb(pid)),
    endRssMb: round(samples.at(-1).rss),
  };
}

async function waitScan(page, count) {
  for (;;) {
    const s = await status(page);
    if (!s.scanning && s.read >= count) return s;
    await sleep(50);
  }
}

const profile = createProfile("local");
const result = { fixtureFiles: EXPECTED };
try {
  await seedProfile(profile, undefined);
  const { app, page, pid } = await launch(profile);
  try {
    await enableHandle(page);
    const core = corePid(pid);
    result.coreIdle = { rssMb: round(rssMb(core)) };
    await page.evaluate(() => (location.hash = "#/library?tab=local"));
    await page.reload();
    await pick(app, playDir);
    await page.getByRole("button", { name: "Add a music folder" }).click();
    const row = page.locator("[data-track-row]", { hasText: "Long Tone" });
    await row.waitFor({ timeout: 30_000 });
    await row.dblclick();
    await page.waitForFunction(() => window.__nuvoPlayer.engine.getView().status === "playing", null, { timeout: 15_000 });
    await sleep(3_000);

    // playback sampler: deck clock against wall time on every animation frame
    await page.evaluate(() => {
      window.__samples = [];
      window.__stop = false;
      const tick = () => {
        window.__samples.push([
          performance.now(),
          window.__nuvoPlayer.decks.clock.positionMs(),
          window.__nuvoPlayer.engine.getView().status === "playing" ? 1 : 0,
        ]);
        if (!window.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await pick(app, fixture);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Add a music folder" }).first().click();
    let finish;
    const finished = new Promise((r) => (finish = r));
    const daemon = watchDaemon(core, finished);
    await sleep(100);
    const final = await waitScan(page, EXPECTED);
    result.firstScanMs = Date.now() - t0;
    finish();
    result.daemonDuringScan = await daemon;
    result.scanStatus = { read: final.read, added: final.added, unreadable: final.unreadable, skippedLinks: final.skippedLinks };
    await sleep(2_000);
    const samples = await page.evaluate(() => {
      window.__stop = true;
      return window.__samples;
    });
    // drift = how far the deck clock fell behind wall time since the scan began; stalls = frames a clock stood still for over 250 ms
    const from = samples.findIndex((s) => s[0] >= samples[0][0]);
    const base = samples[from];
    let worstDrift = 0;
    let worstFrame = 0;
    let notPlaying = 0;
    let stalls = 0;
    for (let i = from + 1; i < samples.length; i++) {
      const drift = samples[i][0] - base[0] - (samples[i][1] - base[1]);
      worstDrift = Math.max(worstDrift, Math.abs(drift));
      worstFrame = Math.max(worstFrame, samples[i][0] - samples[i - 1][0]);
      if (!samples[i][2]) notPlaying++;
      if (samples[i][1] === samples[i - 1][1] && samples[i][0] - samples[i - 1][0] > 250) stalls++;
    }
    const lastPos = samples.at(-1)[1];
    result.playback = {
      frames: samples.length,
      spanMs: round(samples.at(-1)[0] - base[0]),
      advancedMs: round(lastPos - base[1]),
      worstClockDriftMs: round(worstDrift),
      worstFrameGapMs: round(worstFrame),
      notPlayingFrames: notPlaying,
      stalls,
    };
    result.coreAfterScan = { rssMb: round(rssMb(core)) };

    // a rescan after touching 100 files, then one with nothing changed
    const files = [];
    (function collect(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !e.isSymbolicLink()) collect(path.join(dir, e.name));
        else if (e.isFile() && e.name.endsWith(".wav") && files.length < 100 && dir.includes("genre 3")) files.push(path.join(dir, e.name));
      }
    })(fixture);
    const later = new Date(Date.now() + 60_000);
    for (const f of files) fs.utimesSync(f, later, later);
    const t1 = Date.now();
    await page.evaluate(() => fetch("nuvo-core://local/v1/local/rescan", { method: "POST" }));
    await sleep(30);
    let s2;
    for (;;) {
      s2 = await status(page);
      if (!s2.scanning && s2.read > 0 && s2.read <= 200) break;
      if (!s2.scanning && Date.now() - t1 > 15_000) break;
      await sleep(20);
    }
    result.touch100 = { ms: Date.now() - t1, read: s2.read, updated: s2.updated };
    await sleep(2_500); // let the watcher's own scan settle
    const t2 = Date.now();
    await page.evaluate(() => fetch("nuvo-core://local/v1/local/rescan", { method: "POST" }));
    await sleep(30);
    let s3;
    for (;;) {
      s3 = await status(page);
      if (!s3.scanning) break;
      await sleep(20);
    }
    result.noChangeRescanMs = Date.now() - t2;

    // Library tab: open fresh, time until rows, then scroll
    await page.evaluate(() => (location.hash = "#/library"));
    await page.reload();
    await page.evaluate(() => (location.hash = "#/library?tab=local"));
    const t3 = Date.now();
    await page.reload();
    await page.locator("[data-track-row]").first().waitFor({ timeout: 60_000 });
    result.localTabFirstRowMs = Date.now() - t3;
    await sleep(1_500);
    const scroll = await page.evaluate(async () => {
      let scroller = document.querySelector("[data-track-row]").parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== "visible"))
        scroller = scroller.parentElement;
      if (!scroller) throw new Error("no scroller");
      scroller.scrollTop = 0;
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const gaps = [];
      let last = await frame();
      const end = scroller.scrollHeight - scroller.clientHeight;
      const go = async (top) => {
        scroller.scrollTop = top;
        const now = await frame();
        gaps.push(now - last);
        last = now;
      };
      for (let top = 0; top <= end; top += 800) await go(top);
      for (let top = end; top >= 0; top -= 800) await go(top);
      return { gaps, end, drawn: document.querySelectorAll("[data-track-row]").length };
    });
    result.scroll = { ...frameStats(scroll.gaps), distancePx: scroll.end, rowsInDom: scroll.drawn };
    scroll.gaps.length = 0;
    result.rowsInDomIdle = await page.locator("[data-track-row]").count();

    // search: daemon query time through the bridge, then typing in the Library filter
    const queries = ["Утро", "Evening 1", "Северный ветер 7", "Song", "Lantern 19", "Тишина 123", "Harbor", "Огни 9999", "zzzz", "Paper Satellites 3"];
    const times = await page.evaluate(async (qs) => {
      const out = [];
      for (const q of qs) {
        for (let i = 0; i < 3; i++) {
          const t = performance.now();
          const r = await fetch(`nuvo-core://local/v1/local/tracks?limit=100&q=${encodeURIComponent(q)}`);
          await r.json();
          out.push(performance.now() - t);
        }
      }
      return out;
    }, queries);
    result.searchQueryMs = summarize(times, 1);
    const filter = page.getByRole("textbox").first();
    const keystrokes = [];
    const dropped = [];
    for (const query of ["4999", "1234", "777"]) {
      await filter.fill("");
      await sleep(1_500);
      await filter.focus();
      for (let i = 1; i <= query.length; i++) {
        const needle = query.slice(0, i).toLowerCase();
        await page.evaluate((needle) => {
          const rows = "[data-track-row]";
          const signature = () => [...document.querySelectorAll(rows)].map((r) => r.textContent).join("|");
          const before = signature();
          window.__key = new Promise((resolve) => {
            document.addEventListener(
              "input",
              () => {
                const t0 = performance.now();
                const check = () => {
                  const drawn = [...document.querySelectorAll(rows)];
                  if (drawn.length > 0 && signature() !== before && drawn.every((r) => r.textContent.toLowerCase().includes(needle)))
                    resolve(performance.now() - t0);
                  else if (performance.now() - t0 > 1_500) resolve(-1);
                  else requestAnimationFrame(check);
                };
                requestAnimationFrame(check);
              },
              { capture: true, once: true },
            );
          });
        }, needle);
        await page.keyboard.insertText(query[i - 1]);
        const ms = await page.evaluate(() => window.__key);
        if (ms >= 0) keystrokes.push(ms);
        else dropped.push(needle);
        await sleep(300);
      }
    }
    result.filterKeystrokeMs = summarize(keystrokes, 0);
    result.filterKeystrokes = keystrokes.map((k) => Math.round(k));
    // a key whose result left the drawn rows unchanged has nothing to time and is listed here
    result.filterDropped = dropped;
    result.rendererHeapMb = round(await page.evaluate(() => performance.memory?.usedJSHeapSize / 1048576));
  } finally {
    await close(app);
  }
} finally {
  profile.remove();
  fs.rmSync(playDir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
const out = option("--json");
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
