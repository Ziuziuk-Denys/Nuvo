import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";
import { passFirstRun } from "./ui/harness";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
// the core may fetch from this host, the page may not
const COVER = (id: string) => `https://is1-ssl.mzstatic.com/image/thumb/nuvo-e2e/${id}.jpg/512x512bb.jpg`;

interface Handle {
  engine: { playList(tracks: object[]): void; next(): void; getView(): { status: string; index: number } };
}

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;

const refusals = () => app.evaluate(() => (globalThis as unknown as { refusals: string[] }).refusals);

async function putTone(id: string): Promise<void> {
  const status = await main.evaluate(async (id) => {
    const rate = 8_000;
    const data = new DataView(new ArrayBuffer(44 + rate * 20 * 2));
    const text = (at: number, value: string) => [...value].forEach((char, index) => data.setUint8(at + index, char.charCodeAt(0)));
    text(0, "RIFF");
    data.setUint32(4, data.byteLength - 8, true);
    text(8, "WAVEfmt ");
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, 1, true);
    data.setUint32(24, rate, true);
    data.setUint32(28, rate * 2, true);
    data.setUint16(32, 2, true);
    data.setUint16(34, 16, true);
    text(36, "data");
    data.setUint32(40, rate * 20 * 2, true);
    const headers = { "Content-Type": "audio/wav", "X-Nuvo-Codec": "pcm" };
    return (await fetch(`nuvo-core://local/v1/cache/audio/${id}`, { method: "PUT", headers, body: data.buffer })).status;
  }, id);
  expect(status).toBeLessThan(300);
}

beforeAll(async () => {
  isolation = isolate("nuvo-csp-e2e");
  app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--ozone-platform=x11", "--mute-audio", `--user-data-dir=${isolation.userData}`],
    cwd: ROOT,
    env: isolation.env,
  });
  await app.evaluate(({ app: electron, webContents }) => {
    const heard: string[] = [];
    (globalThis as unknown as { refusals: string[] }).refusals = heard;
    const listen = (contents: Electron.WebContents) =>
      contents.on("console-message", (event) => {
        if (event.message.includes("Content Security Policy")) heard.push(`${contents.getURL().split("#")[1] ?? ""} ${event.message}`);
      });
    webContents.getAllWebContents().forEach(listen);
    electron.on("web-contents-created", (_event, contents) => listen(contents));
  });
  main = await app.firstWindow();
  await passFirstRun(main);
  await main.evaluate(() => {
    localStorage.setItem("nuvo.e2e", "1");
    const notch = {
      mode: "on",
      expandOn: "hover",
      showLyrics: true,
      pulseOnTrackChange: false,
      display: "primary",
      position: "center",
      edge: "auto",
      offset: 0,
      stacking: "above",
    };
    localStorage.setItem("nuvo_notch_settings_v1", JSON.stringify({ state: notch, version: 1 }));
    localStorage.setItem("nuvo.visual", JSON.stringify({ enabled: true, stage: false, template: "emblem", toured: true, chosen: true }));
  });
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer));
  await main.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
}, 180_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
  isolation?.dispose();
});

it("the pages of the built app ask for nothing their content policy refuses", async () => {
  const ids = ["csp1", "csp2", "csp3"];
  for (const id of ids) await putTone(id);
  const tracks = ids.map((id) => ({ id, title: `Tone ${id}`, artists: "Nuvo", coverUrl: COVER(id), durationMs: 20_000 }));
  await main.evaluate(async (tracks) => {
    const send = (method: string, path: string, body: object) =>
      fetch(`nuvo-core://local/v1/me/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const playlist = (await (await send("POST", "playlists", { title: "Covers" })).json()) as { id: string };
    for (const { id, title, coverUrl, durationMs } of tracks) {
      const track = { id, title, artists: [{ id: "nuvo", name: "Nuvo" }], cover: { url: coverUrl }, durationMs };
      await send("PUT", `library/tracks/${id}`, { track });
      await send("POST", `playlists/${playlist.id}/tracks/${id}`, { track });
    }
  }, tracks);
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer));
  await main.evaluate((tracks) => (window as unknown as { __nuvoPlayer: Handle }).__nuvoPlayer.engine.playList(tracks), tracks);
  const view = () => main.evaluate(() => (window as unknown as { __nuvoPlayer: Handle }).__nuvoPlayer.engine.getView());
  await expect.poll(async () => (await view()).status, { timeout: 30_000 }).toBe("playing");
  await main.waitForTimeout(2_000);
  await main.evaluate(() => (window as unknown as { __nuvoPlayer: Handle }).__nuvoPlayer.engine.next());
  await expect.poll(async () => (await view()).index, { timeout: 15_000 }).toBe(1);

  for (const hash of ["#/", "#/library", "#/liked", "#/stats", "#/recognize", "#/settings"]) {
    await main.evaluate((hash) => {
      location.hash = hash;
    }, hash);
    await main.waitForTimeout(1_200);
  }
  await main.keyboard.press("Escape");
  await main.getByRole("button", { name: "Open lyrics" }).click();
  await main.mouse.move(640, 120);
  await main.mouse.move(650, 130);
  await main.locator('button[aria-label="Show the scene"]').click();
  await main.waitForTimeout(3_000);
  await main.evaluate(() => window.nuvoShell!.togglePocket());
  await main.waitForTimeout(3_000);

  const notch = app.windows().find((page) => page.url().includes("#/notch"))!;
  await notch.hover(".island");
  await notch.getByRole("button", { name: "Add to playlist" }).click();
  await notch.getByText("Covers").waitFor({ timeout: 10_000 });
  await notch.waitForTimeout(1_000);
  expect(await refusals()).toEqual([]);

  await main.evaluate((src) => {
    new Image().src = src;
  }, COVER("raw"));
  await expect.poll(async () => (await refusals()).length, { timeout: 5_000 }).toBe(1);
}, 180_000);
