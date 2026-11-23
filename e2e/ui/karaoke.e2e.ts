import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, SIZES, type NuvoSession } from "./harness";
import { diffRatio } from "./pixels";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DARK = { preset: "nuvo", mode: "dark" } as const;
const NO_LYRICS = "Looks like we don't have lyrics for this one yet.";
let session: NuvoSession;
let provider: http.Server;

beforeAll(async () => {
  provider = http.createServer((_request, response) => void response.writeHead(404).end());
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.NUVO_CORE_LRCLIB_URL = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  session = await launchNuvo({ profile: "seeded" });
});

afterAll(async () => {
  await session?.close();
  provider?.close();
  delete process.env.NUVO_CORE_LRCLIB_URL;
});

function silentWav(seconds: number): Buffer {
  const rate = 8_000;
  const wav = Buffer.alloc(44 + rate * seconds * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

it("with the background hidden, both sizes differ from the references by at most 1 % of pixels", async () => {
  const page = session.page;
  await page.evaluate(() => localStorage.setItem("nuvo.hint.dislike", "1"));
  await session.go("#/player");
  await session.setLook(DARK);
  await page.addStyleTag({ content: "* { font-family: Arimo !important } canvas, [data-add-lyrics] { visibility: hidden !important }" });
  await page.getByText(NO_LYRICS).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const files = await session.shoot("1-karaoke", "karaoke", "dark", { looks: [DARK] });
  expect(files).toHaveLength(2);
  for (const file of files) {
    const width = /-(\d+)\.png$/.exec(file)![1];
    const reference = path.join(ROOT, "e2e", "reference", `karaoke-nuvo-dark-${width}.png`);
    expect(await diffRatio(session.app, reference, file), `karaoke ${width}`).toBeLessThanOrEqual(0.01);
  }
});

it("the island cover raises the view in dark within 400 ms, Escape takes it back down", async () => {
  const page = session.page;
  await session.go("#/");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('button[aria-label="Open lyrics"]').first().click();
  const overlay = page.locator("[data-phase]");
  await overlay.waitFor({ timeout: 2_000 });
  expect(await overlay.getAttribute("data-theme")).toBe("dark");
  const riseMs = await overlay.evaluate((view) => {
    const style = getComputedStyle(view);
    return (parseFloat(style.transitionDuration) + parseFloat(style.transitionDelay)) * 1000;
  });
  expect(riseMs).toBeLessThan(400);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-phase]")!).transform === "none", undefined, { timeout: 2_000, polling: 16 });
  await page.keyboard.press("Escape");
  await overlay.waitFor({ state: "detached", timeout: 2_000 });
});

it("rests after 3 s of play without moving the cover, wakes for the pointer and for a key, and stays awake when told to", async () => {
  const page = session.page;
  const play = async (controls: "fade" | "always") => {
    await page.evaluate((value) => {
      localStorage.setItem("nuvo.e2e", "1");
      localStorage.setItem("nuvo.karaoke.controls", value);
    }, controls);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer), undefined, { timeout: 30_000 });
    await page.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 30_000 });
    await page.evaluate(
      async ({ id, wav }) => {
        const body = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
        await fetch(`nuvo-core://local/v1/cache/audio/${id}`, { method: "PUT", headers: { "Content-Type": "audio/wav", "X-Nuvo-Codec": "pcm" }, body });
        const { engine } = (window as unknown as { __nuvoPlayer: { engine: { playList(tracks: unknown[]): void } } }).__nuvoPlayer;
        engine.playList([{ id, title: "Rest", artists: "Nova", coverUrl: "", durationMs: 60_000 }]);
      },
      { id: "rest-song", wav: silentWav(60).toString("base64") },
    );
    await session.go("#/player");
    await page.locator('section button[aria-label="Pause"]').waitFor({ state: "attached", timeout: 20_000 });
    await page.mouse.move(700, 300);
  };
  const rest = page.locator("[data-rest]");
  const cover = () => page.locator("section > div").first().boundingBox();

  await play("fade");
  await rest.waitFor({ state: "attached", timeout: 15_000 });
  const asleep = await cover();
  await page.mouse.move(720, 320);
  expect(await rest.count()).toBe(0);
  await page.waitForTimeout(400);
  expect(await cover()).toEqual(asleep);
  for (const size of [...SIZES, { width: 1440, height: 900 }]) {
    await session.setSize(size);
    const gaps = await page.evaluate(() => ({
      above: document.querySelector("section > div")!.getBoundingClientRect().top,
      below: innerHeight - document.querySelector('section button[aria-label="Pause"] path')!.getBoundingClientRect().bottom,
    }));
    expect(Math.abs(gaps.above - gaps.below), `${size.width}: ${gaps.above} above, ${gaps.below} below`).toBeLessThanOrEqual(4);
  }
  await rest.waitFor({ state: "attached", timeout: 8_000 });
  await page.keyboard.press("Shift");
  expect(await rest.count()).toBe(0);

  await play("always");
  await page.waitForTimeout(8_000);
  expect(await rest.count()).toBe(0);
});
