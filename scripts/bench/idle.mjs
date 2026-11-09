#!/usr/bin/env node
import fs from "node:fs";
import { close, cpuPercent, createProfile, homeReady, launch, memory, option, seedProfile, sleep } from "./lib.mjs";
import { round, summarize } from "./stats.mjs";

const exe = option("--exe");
const runs = Number(option("--runs", 5));
const settleSeconds = Number(option("--settle", 30));
const cpuSeconds = Number(option("--cpu", 30));

const profile = createProfile("idle");
const samples = [];
try {
  await seedProfile(profile, exe, { data: true });
  for (let run = 0; run < runs; run++) {
    const { app, page, pid, startedAt, startMs } = await launch(profile, exe);
    // buffered: the entry may already exist or arrive a moment later
    const paintAt = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const observer = new PerformanceObserver((list) => {
            const entry = list.getEntriesByName("first-contentful-paint")[0];
            if (entry) resolve(performance.timeOrigin + entry.startTime);
          });
          observer.observe({ type: "paint", buffered: true });
          setTimeout(() => resolve(NaN), 5_000);
        }),
    );
    await homeReady(page);
    const homeMs = Date.now() - startedAt;
    await sleep(settleSeconds * 1000);
    const mem = memory(pid);
    const cpu = await cpuPercent(pid, cpuSeconds);
    samples.push({ startMs, paintMs: paintAt - startedAt, homeMs, pssMb: mem.total, anonMb: mem.anon, byKind: mem.byKind, counts: mem.counts, cpu });
    console.log(
      `run ${run + 1}: start ${Math.round(startMs)} ms, paint ${Math.round(paintAt - startedAt)} ms, home ${homeMs} ms, PSS ${round(mem.total)} MB (anon ${round(mem.anon)}), CPU ${round(cpu, 2)} %`,
    );
    await close(app);
    await sleep(1_000);
  }
} finally {
  profile.remove();
}

const kinds = [...new Set(samples.flatMap((s) => Object.keys(s.byKind)))];
const summary = {
  exe: exe ?? "dev",
  runs,
  startMs: summarize(
    samples.map((s) => s.startMs),
    0,
  ),
  firstPaintMs: summarize(samples.map((s) => s.paintMs).filter(Number.isFinite), 0),
  homeMs: summarize(
    samples.map((s) => s.homeMs),
    0,
  ),
  idlePssMb: summarize(samples.map((s) => s.pssMb)),
  idleAnonMb: summarize(samples.map((s) => s.anonMb)),
  idleCpuPercent: summarize(
    samples.map((s) => s.cpu),
    2,
  ),
  processCount: samples.at(-1).counts,
  byKindMb: Object.fromEntries(kinds.map((k) => [k, summarize(samples.map((s) => s.byKind[k] ?? 0))?.p50])),
  samples,
};
console.log(JSON.stringify({ ...summary, samples: undefined }, null, 2));
const out = option("--json");
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2));
