#!/usr/bin/env node
// Playing-state memory and CPU: a 90 s tone from the daemon's audio cache is played from a row of
// the 5,000-track playlist (the page stays open). CPU is the whole tree over seconds 40-60, PSS of
// the whole tree is read at 60 s.
// --view karaoke measures with the karaoke view open over the playing song; --reduced-motion emulates
// the system setting for the page. --lyrics lines|words|song gives the song fixture lyrics from a local
// stand-in: line timing, word timing with a word always filling and a new line every 3 s (the worst
// case), or word timing paced like singing, a line every 4.5 s with a rest in it; song-lines is that pace
// with line timing only. --highlight line|word|fill|step picks the karaoke mode. The song plays at volume 0.
// usage: node scripts/bench/playing.mjs [--exe path/to/nuvo] [--runs 5] [--play 60] [--cpu 20] [--view karaoke] [--lyrics words] [--highlight fill] [--reduced-motion] [--json out.json]
import fs from "node:fs";
import http from "node:http";
import { close, cpuPercent, createProfile, enableHandle, homeReady, launch, memory, openPlaylist, option, putTone, round, seedProfile, sleep } from "./lib.mjs";
import { summarize } from "./stats.mjs";

const exe = option("--exe");
const runs = Number(option("--runs", 5));
const playSeconds = Number(option("--play", 60));
const cpuSeconds = Number(option("--cpu", 20));
const ROW = 5;
const view = option("--view", "playlist");
const reducedMotion = process.argv.includes("--reduced-motion");
if (view !== "playlist" && view !== "karaoke") throw new Error(`unknown --view ${view}`);
const lyrics = option("--lyrics");
if (lyrics !== undefined && !["lines", "words", "song", "song-lines"].includes(lyrics)) throw new Error(`unknown --lyrics ${lyrics}`);
const highlight = option("--highlight");
if (highlight !== undefined && !["line", "word", "fill", "step"].includes(highlight)) throw new Error(`unknown --highlight ${highlight}`);

function stamp(ms) {
  const part = (value, size = 2) => String(Math.floor(value)).padStart(size, "0");
  return `${part(ms / 60_000)}:${part((ms / 1000) % 60)}.${part((ms % 1000) / 10)}`;
}

/** Six words a line; word stamps close the last word, so a rest after it stays unfilled. */
function fixtureLrc(wordTimed, lineMs, wordMs) {
  const lines = [];
  for (let at = 1000; at < (playSeconds + 30) * 1000; at += lineMs) {
    const words = ["Morning ", "light ", "over ", "the ", "quiet ", "hill"].map((word, index) => (wordTimed ? `<${stamp(at + index * wordMs)}>${word}` : word));
    lines.push(`[${stamp(at)}]${words.join("")}${wordTimed ? `<${stamp(at + 6 * wordMs)}>` : ""}`);
  }
  return lines.join("\n");
}

let provider = null;
if (lyrics) {
  const paced = lyrics === "song" || lyrics === "song-lines";
  const synced = paced ? fixtureLrc(lyrics === "song", 4500, 500) : fixtureLrc(lyrics === "words", 3000, 500);
  provider = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ id: 1, trackName: "Track", artistName: "Artist", duration: 180, instrumental: false, plainLyrics: null, syncedLyrics: synced }),
    );
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.NUVO_CORE_LRCLIB_URL = `http://127.0.0.1:${provider.address().port}`;
  process.env.NUVO_CORE_AMLL_URL = "";
}

const profile = createProfile("playing");
const samples = [];
try {
  await seedProfile(profile, exe, { data: true });
  for (let run = 0; run < runs; run++) {
    const { app, page, pid } = await launch(profile, exe);
    try {
      if (highlight) await page.evaluate((mode) => localStorage.setItem("nuvo.karaoke.highlight", mode), highlight);
      await enableHandle(page);
      if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
      await homeReady(page);
      await putTone(page, `bench-${String(ROW).padStart(4, "0")}`, playSeconds + 30);
      await openPlaylist(page, profile.playlistId);
      await page.evaluate(() => window.__nuvoPlayer.decks.setVolume(0));
      await page.locator("[data-track-row]").nth(ROW).dblclick();
      await page.waitForFunction(() => window.__nuvoPlayer.engine.getView().status === "playing", null, { timeout: 15_000 });
      if (view === "karaoke") {
        await page.evaluate(() => (location.hash = "#/player"));
        await page.locator('[role=slider][aria-label="Seek"]').waitFor({ timeout: 15_000 });
      }
      if (lyrics) await page.locator("braccato-lyrics .blyrics--line").first().waitFor({ timeout: 15_000 });
      await sleep((playSeconds - cpuSeconds) * 1000);
      const cpu = await cpuPercent(pid, cpuSeconds);
      const ending = await page.evaluate(() => ({
        status: window.__nuvoPlayer.engine.getView().status,
        positionMs: window.__nuvoPlayer.decks.clock.positionMs(),
        fills: document.querySelectorAll("braccato-lyrics [data-nuvo-now], braccato-lyrics [data-nuvo-fill]").length,
      }));
      if (lyrics !== undefined && ending.fills === 0) throw new Error("nothing was lit");
      if (ending.status !== "playing" || ending.positionMs < (playSeconds - 5) * 1000) throw new Error(`not playing at the end: ${JSON.stringify(ending)}`);
      const mem = memory(pid);
      samples.push({ pssMb: mem.total, anonMb: mem.anon, byKind: mem.byKind, counts: mem.counts, cpu });
      console.log(
        `run ${run + 1}: PSS ${round(mem.total)} MB (anon ${round(mem.anon)}), CPU ${round(cpu, 2)} %, position ${Math.round(ending.positionMs / 1000)} s`,
      );
    } catch (error) {
      console.log(`run ${run + 1} failed: ${String(error).split("\n")[0]}`);
    }
    await close(app);
    await sleep(1_000);
  }
} finally {
  profile.remove();
  provider?.close();
}

const kinds = [...new Set(samples.flatMap((s) => Object.keys(s.byKind)))];
const summary = {
  exe: exe ?? "dev",
  view,
  lyrics,
  highlight,
  reducedMotion,
  runs,
  playSeconds,
  playingPssMb: summarize(samples.map((s) => s.pssMb)),
  playingAnonMb: summarize(samples.map((s) => s.anonMb)),
  playingCpuPercent: summarize(
    samples.map((s) => s.cpu),
    2,
  ),
  processCount: samples.at(-1)?.counts,
  byKindMb: Object.fromEntries(kinds.map((k) => [k, summarize(samples.map((s) => s.byKind[k] ?? 0))?.p50])),
  samples,
};
console.log(JSON.stringify({ ...summary, samples: undefined }, null, 2));
const out = option("--json");
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2));
