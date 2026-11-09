import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, type NuvoSession } from "./harness";
import { coverBase } from "./seed";

const ALBUMS = 5_000;
const BATCH = 100;
const REPORT = path.resolve(import.meta.dirname, "..", "artifacts", "ui", "2-library", "library-big.json");
const MB = 1024 * 1024;
// Regression ceiling: the cold visit fetches all 5000 rows over IPC and measured 100 ms
const COLD_CEILING_MS = 400;

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

const ROWS = '[data-view] [style*="translateY"] [role="button"]';

async function seedAlbums(live: NuvoSession): Promise<void> {
  const port = await coverBase();
  await live.core(
    `const port = ${port};
     const total = ${ALBUMS};
     for (let start = 0; start < total; start += ${BATCH}) {
       const batch = [];
       for (let i = start; i < Math.min(start + ${BATCH}, total); i += 1) {
         const snapshot = {
           id: "big-album-" + String(i).padStart(5, "0"),
           title: "Album " + (i + 1),
           author: "Artist " + (i % 400),
           cover: { url: "http://127.0.0.1:" + port + "/" + (i % 64) + ".svg" },
           trackCount: 8 + (i % 12),
         };
         batch.push(fetch(base + "/v1/me/library/albums/" + snapshot.id, { method: "PUT", headers: json, body: JSON.stringify({ snapshot }) })
           .then((res) => { if (!res.ok) throw new Error("album " + res.status); }));
       }
       await Promise.all(batch);
     }`,
  );
}

function timeToRows(page: Page): Promise<number> {
  return page.evaluate(
    (selector) =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll(selector).length >= 12) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        location.hash = "#/library";
      }),
    ROWS,
  );
}

async function heapAfterGc(live: NuvoSession): Promise<number> {
  const cdp = await live.page.context().newCDPSession(live.page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.detach();
  return live.page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize);
}

async function rendererWorkingSet(live: NuvoSession): Promise<number> {
  const metrics = await live.app.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === "Tab"));
  return Math.max(...metrics.map((metric) => metric.memory.workingSetSize)) / 1024;
}

interface ScrollRun {
  maxRows: number;
  frames: number[];
}

function scrollPasses(page: Page, passes: number): Promise<ScrollRun> {
  return page.evaluate(
    async ({ selector, passes }) => {
      const list = document.querySelector("[data-view]")!;
      let scroller: HTMLElement | null = list.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== "visible")) {
        scroller = scroller.parentElement;
      }
      if (!scroller) throw new Error("no scroller");
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      let maxRows = 0;
      const frames: number[] = [];
      let last = await frame();
      const step = async (top: number) => {
        scroller!.scrollTop = top;
        const now = await frame();
        frames.push(now - last);
        last = now;
        maxRows = Math.max(maxRows, document.querySelectorAll(selector).length);
      };
      for (let pass = 0; pass < passes; pass += 1) {
        const end = scroller.scrollHeight - scroller.clientHeight;
        for (let top = 0; top <= end; top += 1200) await step(top);
        await step(end);
        for (let top = end; top >= 0; top -= 1200) await step(top);
        await step(0);
      }
      return { maxRows, frames };
    },
    { selector: ROWS, passes },
  );
}

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];

describe("Library with 5000 saved albums", () => {
  it("paints the first rows fast, keeps a flat DOM and a flat heap", { timeout: 900_000 }, async () => {
    session = await launchNuvo({ profile: "fresh", args: ["--enable-precise-memory-info"] });
    const live = session;
    await passFirstRun(live.page);
    const seedStart = Date.now();
    await seedAlbums(live);
    const seedMs = Date.now() - seedStart;
    await live.page.evaluate(() => localStorage.setItem("nuvo_library_view_mode", "list"));
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await live.page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
    await live.setSize({ width: 1200, height: 780 });

    const cold = await timeToRows(live.page);
    await live.page.waitForTimeout(1_500);
    const warm: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      await live.go("#/");
      await live.page.waitForTimeout(400);
      warm.push(await timeToRows(live.page));
      await live.page.waitForTimeout(400);
    }
    const rowsAtRest = await live.page.locator(ROWS).count();

    await live.page.waitForTimeout(1_000);
    const heapBefore = await heapAfterGc(live);
    const workingBefore = await rendererWorkingSet(live);
    const scroll = await scrollPasses(live.page, 3);
    await live.page.waitForTimeout(1_000);
    const heapAfter = await heapAfterGc(live);
    const workingAfter = await rendererWorkingSet(live);

    const numbers = {
      albums: ALBUMS,
      seedMs,
      coldVisitMs: Math.round(cold),
      coldCeilingMs: COLD_CEILING_MS,
      warmVisitsMs: warm.map((value) => Math.round(value)),
      warmMedianMs: Math.round(percentile(warm, 0.5)),
      rowsAtRest,
      maxRowsWhileScrolling: scroll.maxRows,
      scrollFrames: scroll.frames.length,
      frameP50Ms: Math.round(percentile(scroll.frames, 0.5) * 10) / 10,
      frameP95Ms: Math.round(percentile(scroll.frames, 0.95) * 10) / 10,
      frameMaxMs: Math.round(Math.max(...scroll.frames) * 10) / 10,
      heapBeforeMb: Math.round((heapBefore / MB) * 10) / 10,
      heapAfterMb: Math.round((heapAfter / MB) * 10) / 10,
      heapGrowthMb: Math.round(((heapAfter - heapBefore) / MB) * 10) / 10,
      rendererWorkingSetBeforeMb: Math.round(workingBefore),
      rendererWorkingSetAfterMb: Math.round(workingAfter),
    };
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify(numbers, null, 2));
    console.log("library-big", JSON.stringify(numbers));

    expect(numbers.warmMedianMs, "hash change to 12 rows, warm").toBeLessThan(100);
    expect(cold, "hash change to 12 rows, cold first visit").toBeLessThan(COLD_CEILING_MS);
    expect(scroll.maxRows, "rows in the DOM at any time").toBeLessThanOrEqual(60);
    expect(heapAfter - heapBefore, "heap growth after three passes").toBeLessThan(10 * MB);
  });
});
