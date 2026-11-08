#!/usr/bin/env node
// Runs the whole Nuvo benchmark suite on the current app (M1 start and idle, M2 track start,
// playing memory and CPU, UI speed), one script after the other so they never overlap, then writes
// one JSON and appends a dated section with a table to the bench doc.
// Uncached track start needs the network: NUVO_BENCH_LIVE=1 turns it on, it is skipped otherwise.
// usage: node scripts/bench/suite.mjs [--exe path/to/nuvo] [--runs 5] [--json out.json] [--doc bench.md]
import { execFileSync, spawnSync } from "node:child_process";
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { ROOT, option } from "./lib.mjs";
import { markdownTable } from "./stats.mjs";

const exe = option("--exe");
const runs = option("--runs", "5");
const day = new Date().toISOString().slice(0, 10);
const jsonPath = path.resolve(ROOT, option("--json", `bench-results/${day}-suite.json`));
const docPath = path.resolve(ROOT, option("--doc", "bench-results/bench.md"));
const live = process.env.NUVO_BENCH_LIVE === "1";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-bench-suite-"));
const common = [...(exe ? ["--exe", exe] : []), "--runs", runs];
const parts = {};
try {
  for (const name of ["idle", "latency", "playing", "ui"]) {
    const out = path.join(work, `${name}.json`);
    console.log(`== ${name}`);
    const result = spawnSync("node", [path.join(import.meta.dirname, `${name}.mjs`), ...common, "--json", out], { stdio: "inherit", cwd: ROOT });
    parts[name] = result.status === 0 && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
    if (!parts[name]) console.log(`${name} failed (exit ${result.status})`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT }).toString().trim();
const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/electron/package.json"), "utf8")).version;
const meta = {
  date: day,
  commit: git("rev-parse", "--short", "HEAD"),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  app: exe ?? "repo build on the dev Electron",
  electron: electronVersion,
  cpu: `${os.cpus()[0].model} x${os.cpus().length}`,
  kernel: os.release(),
  loadavgAtEnd: os.loadavg().map((v) => Math.round(v * 100) / 100),
  runs: Number(runs),
  live,
};
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.mkdirSync(path.dirname(docPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify({ meta, ...parts }, null, 2));

const { idle, latency, playing, ui } = parts;
const uncached = latency?.uncached;
const rows = [
  ["M1 window with text", "ms", idle?.startMs],
  ["M1 first contentful paint", "ms", idle?.firstPaintMs],
  ["M1 Home with data", "ms", idle?.homeMs],
  ["M2 track start, cached, first start of a session (audio moving)", "ms", latency?.cachedFirstStart.audioMs],
  ["M2 track start, cached, first start (`playing` event)", "ms", latency?.cachedFirstStart.playingMs],
  ["M2 track start, cached, later starts (audio moving)", "ms", latency?.cachedLaterStarts.audioMs],
  ["M2 track start, cached, later starts (`playing` event)", "ms", latency?.cachedLaterStarts.playingMs],
  ["M2 track start, uncached (audio moving)", "ms", live ? uncached?.network?.audioMs : "skipped, needs NUVO_BENCH_LIVE=1"],
  ["Memory idle, 30 s after Home (PSS, whole tree)", "MB", idle?.idlePssMb],
  ["Memory playing, 60 s (PSS, whole tree)", "MB", playing?.playingPssMb],
  ["CPU idle (whole tree, % of one core)", "%", idle?.idleCpuPercent],
  ["CPU playing (whole tree, % of one core)", "%", playing?.playingCpuPercent],
  ["Scroll 5,000-track playlist, frame gap p95 per run", "ms", ui?.scrollFrameP95Ms],
  ["Scroll 5,000-track playlist, share of frames over 20 ms", "share", ui?.scrollSlowFrameShare],
  ["Library filter, 5,000 albums, per keystroke", "ms", ui?.filterKeystrokeMs],
];
const section = `
## Suite on the current app, ${day}

Commit \`${meta.commit}\` on \`${meta.branch}\`. ${meta.app}, Electron ${meta.electron}, ${meta.cpu}, Linux ${meta.kernel}. ${runs} runs per measurement; p50 and p95 are taken over the runs (the keystroke and the cached-later rows pool every sample of the runs). Run with \`node scripts/bench/suite.mjs\`, one script after the other, each on its own temporary profile (XDG dirs, user data dir, socket, a \`nuvo-core-test-<pid>-<random>\` keyring service of its own).

${markdownTable(rows)}

Method:
- Fixture: a 5,000-track playlist and 5,000 saved albums written to the daemon; no network is used.
- M1: from the launch call to the first frame with text, the first contentful paint, and the first Home section (or its empty state).
- M2: a double click on a track row to the first animation frame where the engine's deck clock is above 0 and the engine says \`playing\`; the \`playing\` event of the deck is listed beside it. Tones are put in the daemon's audio cache, so this is the cached path. The first start of a session (the audio graph is built then) is kept apart from the four later starts.
- Memory and CPU: PSS from \`/proc/<pid>/smaps_rollup\` and CPU ticks from \`/proc/<pid>/stat\` over every process under the launched main process. Idle is read 30 s after Home (CPU over 30 s). Playing is a 90 s cached tone started from a playlist row, CPU over seconds 40-60, PSS at 60 s, with the 5,000-row playlist open.
- Scroll: the playlist page is scrolled down and back at 800 px per animation frame; frame gaps come from \`requestAnimationFrame\`.
- Filter: typing 4999, 1234 and 777 into the Library filter with real key events; the time runs from the \`keydown\` reaching the page to the first frame where the drawn rows changed and all contain the typed text. A key whose result left the rows unchanged is dropped.

Not measured:
${live ? "" : "- Uncached track start: needs the network and a YouTube session. Off unless \`NUVO_BENCH_LIVE=1\`.\n"}- The reference players were not run in this section; their numbers are in the same-day table above or missing.
- The repo build runs on the dev Electron with the debug daemon unless \`--exe\` points to a packaged build, so absolute numbers are higher than a release build's.
- Other apps on the machine take CPU and memory bandwidth: the load average at the end of the run was ${meta.loadavgAtEnd.join(" ")}.
`;
fs.appendFileSync(docPath, section);
console.log(`wrote ${jsonPath} and appended to ${docPath}`);
console.log(markdownTable(rows));
