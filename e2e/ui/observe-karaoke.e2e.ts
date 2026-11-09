import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, RECORDING, SIZES, type NuvoSession } from "./harness";
import { PLAYER_SESSION_KEY } from "./seed";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "src", "ui", "karaoke", "look.json");
const FRAMES = path.join(ROOT, "e2e", "artifacts", "ui", "karaoke-observed");
const SONG = { id: "fJ9rUzIMcZQ", title: "Bohemian Rhapsody", artist: "Queen", durationMs: 354_000 };
let session: NuvoSession;

beforeAll(async () => {
  session = await launchNuvo({ profile: "seeded", args: ["--mute-audio"] });
});
afterAll(async () => session?.close());

async function press(label: string): Promise<void> {
  const found = await session.page.evaluate((name) => {
    for (const button of document.querySelectorAll("button")) {
      if (button.getAttribute("aria-label") !== name) continue;
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (box.width > 0 && hit && button.contains(hit)) {
        button.click();
        return true;
      }
    }
    return [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).join(", ");
  }, label);
  if (found !== true) throw new Error(`no visible button "${label}"; labels: ${found}`);
}

it.runIf(RECORDING)("measures the karaoke view", async () => {
  const page = session.page;
  fs.mkdirSync(FRAMES, { recursive: true });
  await session.setLook({ preset: "nuvo", mode: "dark" });
  await page.waitForTimeout(1_100);
  await page.evaluate(
    ([key, song]) => {
      const stored = JSON.parse(localStorage.getItem(key)!);
      const track = stored.entries[1].track;
      Object.assign(track, { id: song.id, title: song.title, artists: song.artist, artistList: [{ id: "", name: song.artist }], durationMs: song.durationMs });
      localStorage.setItem(key, JSON.stringify(stored));
    },
    [PLAYER_SESSION_KEY, SONG] as const,
  );
  await page.reload();
  await page.locator('button[aria-label="Open lyrics"]').first().waitFor({ timeout: 30_000 });
  await session.setSize(SIZES[0]);
  await session.go("#/player");
  await page.waitForTimeout(1_500);
  await press("Next track");
  await page.getByText("Is this the real life?", { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(40_000);

  const sizes: Record<string, unknown> = {};
  for (const size of SIZES) {
    await session.setSize(size);
    // once a song plays, the compositor may keep the old window size; the viewport override lays out the same way
    await page.setViewportSize(size);
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: path.join(FRAMES, `view-${size.width}.png`) });
    sizes[String(size.width)] = await page.evaluate(() => {
      const visible = (el: Element) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && style.visibility !== "hidden" && Number(style.opacity) > 0.02;
      };
      const round = (n: number) => Math.round(n * 10) / 10;
      const onTop = (el: Element) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.min(box.x + box.width / 2, innerWidth - 1), Math.min(box.y + box.height / 2, innerHeight - 1));
        return !!hit && (el.contains(hit) || hit.contains(el));
      };
      const texts = [...document.querySelectorAll("body *")]
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && visible(el) && onTop(el))
        .map((el) => {
          const box = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          let opacity = 1;
          for (let at: Element | null = el; at; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity);
          return {
            text: el.textContent!.trim().slice(0, 40),
            x: round(box.x),
            y: round(box.y),
            w: round(box.width),
            h: round(box.height),
            fontSize: parseFloat(s.fontSize),
            fontWeight: s.fontWeight,
            color: s.color,
            letterSpacing: s.letterSpacing,
            lineHeight: s.lineHeight,
            opacity: Math.round(opacity * 1000) / 1000,
            filter: s.filter,
            transform: s.transform,
            fill: s.webkitTextFillColor,
            image: s.backgroundImage.slice(0, 160),
          };
        });
      const controls = [...document.querySelectorAll("button, [role=slider]")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return visible(el) && !!hit && el.contains(hit);
        })
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            name: el.getAttribute("aria-label") ?? el.textContent!.trim().slice(0, 30),
            x: round(box.x),
            y: round(box.y),
            w: round(box.width),
            h: round(box.height),
          };
        });
      const images = [...document.querySelectorAll("img")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return visible(el) && !!hit && (hit === el || hit.contains(el) || el.parentElement!.contains(hit));
        })
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { x: round(box.x), y: round(box.y), w: round(box.width), h: round(box.height), radius: getComputedStyle(el).borderRadius };
        });
      return { viewport: [innerWidth, innerHeight], texts, controls, images };
    });
  }

  await session.setSize(SIZES[0]);
  await page.setViewportSize(SIZES[0]);
  const style = await page.addStyleTag({ content: "#root * { visibility: hidden !important } #root canvas { visibility: visible !important }" });
  for (let i = 0; i < 10; i += 1) {
    await page.screenshot({ path: path.join(FRAMES, `background-${String(i).padStart(2, "0")}.png`) });
    await page.waitForTimeout(2_000);
  }
  await style.evaluate((node) => (node as Element).remove());
  const layers = await page.evaluate(() =>
    [...document.querySelectorAll('body [data-theme="dark"] *')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width >= innerWidth * 0.9 && box.height >= innerHeight * 0.9 && el.childElementCount <= 2;
      })
      .map((el) => {
        const s = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          background: s.backgroundColor,
          image: s.backgroundImage.slice(0, 300),
          opacity: s.opacity,
          filter: s.filter,
          backdropFilter: s.backdropFilter,
          blend: s.mixBlendMode,
          transform: s.transform,
        };
      }),
  );
  const canvases = await page.evaluate(() =>
    [...document.querySelectorAll("canvas")].map((c) => ({ width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight })),
  );

  await session.go("#/");
  await page.waitForTimeout(800);
  const samples = await page.evaluate(async () => {
    const opener = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Open lyrics") as HTMLButtonElement | undefined;
    opener?.click();
    const tops: number[] = [];
    const times: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 800) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const view = [...document.querySelectorAll('body [data-theme="dark"]')].find((el) => el.getBoundingClientRect().width >= innerWidth - 1);
      tops.push(view ? Math.round((view.getBoundingClientRect().top / innerHeight) * 1000) / 1000 : 1);
      times.push(Math.round(performance.now() - start));
    }
    return { tops, times };
  });
  const settled = samples.tops.findIndex((top) => top <= 0.001);
  expect(settled, "the view reaches the top").toBeGreaterThanOrEqual(0);
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ sizes, canvases, layers, overlay: { durationMs: samples.times[settled], samples: samples.tops, sampleTimesMs: samples.times } }, null, 2)}\n`,
  );
});
