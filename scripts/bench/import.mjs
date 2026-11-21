#!/usr/bin/env node
import fs from "node:fs";
import { close, core, createProfile, homeReady, launch, option, seedProfile, sleep } from "./lib.mjs";
import { summarize } from "./stats.mjs";

const exe = option("--exe");
const runs = Number(option("--runs", 3));
const url = option("--url", "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO");

const results = { readMs: [], matchMs: [], totals: [], failures: [] };

async function importOnce(page) {
  await page.evaluate(() => (location.hash = "#/library"));
  await page.getByRole("button", { name: "Create playlist" }).first().click();
  await page.getByRole("button", { name: "Import from a link" }).click();
  const field = page.getByPlaceholder(/Paste a link from/).first();
  await field.waitFor({ timeout: 10_000 });
  await field.fill(url);
  const readAt = Date.now();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  const start = page.locator('[role="dialog"]').getByRole("button", { name: "Import", exact: true });
  await start.waitFor({ timeout: 60_000 });
  const readMs = Date.now() - readAt;
  const before = await core(page, `return (await (await fetch(base + "/v1/imports")).json()).items.map((item) => item.id);`);
  const matchAt = Date.now();
  await start.click();
  for (;;) {
    const item = await core(page, `return (await (await fetch(base + "/v1/imports")).json()).items.find((item) => !arg.includes(item.id)) ?? null;`, before);
    if (item?.status === "done") return { readMs, matchMs: Date.now() - matchAt, total: item.total, counts: item.counts };
    if (Date.now() - matchAt > 600_000) throw new Error("import did not finish in 10 min");
    await sleep(100);
  }
}

for (let run = 0; run < runs; run++) {
  const profile = createProfile("import");
  try {
    await seedProfile(profile, exe);
    const { app, page } = await launch(profile, exe);
    try {
      await homeReady(page);
      const sample = await importOnce(page);
      results.readMs.push(sample.readMs);
      results.matchMs.push(sample.matchMs);
      results.totals.push(sample.total);
      console.log(`run ${run + 1}: read ${sample.readMs} ms, match ${sample.matchMs} ms, ${sample.total} rows ${JSON.stringify(sample.counts)}`);
    } catch (error) {
      results.failures.push({ run, error: String(error).split("\n")[0] });
      console.log(`run ${run + 1} failed: ${String(error).split("\n")[0]}`);
    }
    await close(app);
  } finally {
    profile.remove();
  }
  await sleep(1_000);
}

const summary = {
  exe: exe ?? "dev",
  url,
  runs,
  readMs: summarize(results.readMs, 0),
  matchMs: summarize(results.matchMs, 0),
  totals: results.totals,
  failures: results.failures,
};
console.log(JSON.stringify(summary, null, 2));
const out = option("--json");
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2));
