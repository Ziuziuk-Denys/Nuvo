import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

const DARK = { preset: "nuvo", mode: "dark" } as const;
let session: NuvoSession;

const consoleLines: string[] = [];

beforeAll(async () => {
  session = await launchNuvo({ profile: "seeded" });
  session.page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") consoleLines.push(`${message.type()}: ${message.text()}`);
  });
  session.page.on("pageerror", (error) => consoleLines.push(`pageerror: ${error.message}`));
});

afterAll(async () => {
  const log = path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "console.txt");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, [...new Set(consoleLines)].join("\n"));
  await session?.close();
});

function framesPerSecond(): Promise<number> {
  return session.page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start < 3_000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (performance.now() - start));
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function litShare(name: string): Promise<number> {
  const shot = path.join(import.meta.dirname, "..", "artifacts", "ui", name);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await session.page.locator("canvas[aria-hidden]").first().screenshot({ path: shot });
  return session.app.evaluate(({ nativeImage }, file) => {
    const pixels = nativeImage.createFromPath(file).toBitmap();
    let bright = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 120) bright++;
    return bright / (pixels.length / 4);
  }, shot);
}

it("the visual player draws a lit scene in the karaoke view at 60 fps", async () => {
  const page = session.page;
  await page.evaluate(() =>
    localStorage.setItem("nuvo.visual", JSON.stringify({ enabled: true, stage: true, template: "emblem", toured: true, chosen: true })),
  );
  await page.reload();
  await session.go("#/player");
  await session.setLook(DARK);
  const toggle = page.locator('button[aria-label="Show the lyrics"]');
  await toggle.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_500);

  const fps = await framesPerSecond();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "none";
  });
  console.info(`visual player: ${fps.toFixed(1)} fps on ${renderer}`);
  expect(fps).toBeGreaterThan(55);

  expect(await litShare("visual-canvas.png")).toBeGreaterThan(0.002);

  await session.shoot("visual", "stage", "emblem", { looks: [DARK] });
  await toggle.click();
  await page.locator('button[aria-label="Show the scene"]').waitFor({ timeout: 5_000 });
});

it("the Poster scene plays in the karaoke view at 60 fps", async () => {
  const page = session.page;
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("nuvo.visual") ?? "{}");
    localStorage.setItem("nuvo.visual", JSON.stringify({ ...stored, stage: true, template: "poster" }));
  });
  await page.reload();
  await session.go("#/player");
  await page.locator('button[aria-label="Show the lyrics"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  const fps = await framesPerSecond();
  console.info(`poster scene: ${fps.toFixed(1)} fps`);
  expect(fps).toBeGreaterThan(55);
  expect(await litShare("visual-poster.png")).toBeGreaterThan(0.002);
  await page.locator('button[aria-label="Show the lyrics"]').click();
  await page.locator('button[aria-label="Show the scene"]').waitFor({ timeout: 5_000 });
});

it("the karaoke column comes back over the dimmed scene, and the studio opens full screen", async () => {
  const page = session.page;
  await page.locator('button[aria-label="Show the scene"]').click();
  const column = page.locator("section[class*=left]");
  await column.hover();
  await page.waitForTimeout(900);
  expect(await column.evaluate((element) => getComputedStyle(element.firstElementChild!).opacity)).toBe("1");
  await page.screenshot({ path: path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "stage-column.png") });
  const volume = page.getByRole("slider", { name: "Volume" });
  const handle = (await volume.boundingBox())!;
  await page.mouse.move(handle.x + handle.width * 0.8, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width * 0.6, handle.y + handle.height / 2);
  await page.mouse.up();
  await page.mouse.move(handle.x + 700, handle.y - 300);
  await page.waitForTimeout(600);
  expect(await column.evaluate((element) => getComputedStyle(element.firstElementChild!).opacity)).toBe("0");
  await page.evaluate(() => {
    const pill = document.querySelector("[data-stage-reveal]");
    pill?.querySelector("button")?.setAttribute("aria-expanded", "true");
  });
  await page.waitForTimeout(800);
  expect(
    await page
      .locator("[data-stage-reveal]")
      .first()
      .evaluate((element) => getComputedStyle(element).opacity),
  ).toBe("1");
  await page.evaluate(() => document.querySelector("[data-stage-reveal] button")?.setAttribute("aria-expanded", "false"));
  await page.locator('button[aria-label="Edit the scene"]').click();
  await page.getByRole("dialog", { name: "Scene studio" }).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll("img[src^='blob:']").length >= 6, undefined, { timeout: 20_000 });
  await page.waitForTimeout(800);
  const files = await session.shoot("visual", "studio", "scenes", { looks: [DARK] });
  expect(files.length).toBeGreaterThan(0);
});

it("the studio exports the picked range as an MP4 with the song under it", async () => {
  const page = session.page;
  const status = await page.evaluate(async () => {
    const rate = 8000;
    const seconds = 70;
    const samples = rate * seconds;
    const view = new DataView(new ArrayBuffer(44 + samples * 2));
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    text(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 6) * (i % 4000 < 800 ? 12000 : 2000)), true);
    const response = await fetch("nuvo-core://local/v1/cache/audio/seed-0001", { method: "PUT", headers: { "content-type": "audio/wav" }, body: view.buffer });
    return response.status;
  });
  expect(status).toBeLessThan(300);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-clip-e2e-"));
  const out = path.join(dir, "clip.mp4");
  await session.app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, out);

  await page.getByRole("option", { name: "Poster" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "720p", exact: true }).click();
  await page.getByRole("button", { name: "30 fps", exact: true }).click();
  await session.shoot("visual", "studio", "export", { looks: [DARK] });
  await page.getByRole("button", { name: "Save clip" }).click();
  await page.getByRole("dialog", { name: "Your clip is ready" }).waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => document.querySelectorAll("[class*=strip] img").length >= 4, undefined, { timeout: 30_000 });
  await page.waitForTimeout(600);
  await session.shoot("visual", "studio", "exported", { looks: [DARK] });
  await page.getByRole("button", { name: "Done", exact: true }).click();

  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,duration", "-of", "compact=p=0:nk=1", out],
    { encoding: "utf8" },
  );
  console.info(`exported clip: ${probe.trim().replace(/\n/g, " / ")}`);
  expect(probe).toContain("h264|720|1280|30/1|15.000000");
  expect(probe).toMatch(/aac\|0\/0\|15\.0/);
  const still = path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "exported-frame.png");
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-ss", "2", "-i", out, "-frames:v", "1", still]);
  expect(fs.existsSync(still)).toBe(true);
  fs.rmSync(dir, { recursive: true, force: true });
});

it("a scene picked in the studio becomes the player's scene, even from random mode", async () => {
  const page = session.page;
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("nuvo.visual") ?? "{}");
    localStorage.setItem("nuvo.visual", JSON.stringify({ ...stored, template: "random" }));
  });
  await page.getByRole("option", { name: "Glass" }).click();
  await page.getByRole("button", { name: "Use as player", exact: true }).click();
  await page.getByRole("dialog", { name: "Scene studio" }).waitFor({ state: "detached", timeout: 10_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nuvo.visual") ?? "{}"));
  expect(stored.template).toBe("own");
  expect(stored.scene).toMatchObject({ background: "glass", lyrics: "wipe" });
});

it("controls turn dark over a light scene", async () => {
  const page = session.page;
  await page.evaluate(() =>
    localStorage.setItem(
      "nuvo.visual",
      JSON.stringify({
        enabled: true,
        stage: true,
        template: "own",
        toured: true,
        chosen: true,
        scene: { background: "white", atmosphere: [], centrepiece: null, lyrics: "paper" },
      }),
    ),
  );
  await page.reload();
  await session.go("#/player");
  await page.locator("[data-scene-tone=light]").waitFor({ timeout: 10_000 });
  await page.locator("section[class*=left]").hover();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "stage-light.png") });
});

it("the karaoke view asks once how songs should look, and the first scene plays a demo song through the tour, then returns to the song", async () => {
  type Player = { engine: { getView(): { status: string; current: { track: { id: string } } | null } } };
  const page = session.page;
  await page.evaluate(() => {
    localStorage.removeItem("nuvo.visual");
    localStorage.setItem("nuvo.e2e", "1");
  });
  await page.reload();
  await session.go("#/player");
  await page.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: Player }).__nuvoPlayer?.engine.getView().current), undefined, {
    timeout: 30_000,
  });
  const track = await page.evaluate(() => (window as unknown as { __nuvoPlayer: Player }).__nuvoPlayer.engine.getView().current!.track);
  const lrc = Array.from(
    { length: 60 },
    (_, i) => `[${String(Math.floor(i / 20)).padStart(2, "0")}:${String((i % 20) * 3).padStart(2, "0")}.00]Hold this sound until the morning`,
  ).join("\n");
  await page.evaluate(
    async ({ id, content }) => {
      await fetch(`nuvo-core://local/v1/tracks/${encodeURIComponent(id)}/lyrics/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "lrc", content }),
      });
      await (window as unknown as { __nuvoLyrics: { reload(track: unknown): Promise<void> } }).__nuvoLyrics.reload(
        (window as unknown as { __nuvoPlayer: Player }).__nuvoPlayer.engine.getView().current!.track,
      );
    },
    { id: track.id, content: lrc },
  );
  const choice = page.getByRole("group", { name: "How should songs look?" });
  await choice.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "choice.png") });
  await choice.getByRole("button", { name: /^Karaoke/ }).hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "choice-hover.png") });
  await choice.getByRole("button", { name: /^Scene/ }).click();
  await choice.waitFor({ state: "detached", timeout: 5_000 });
  const playing = () => page.evaluate(() => (window as unknown as { __nuvoPlayer: Player }).__nuvoPlayer.engine.getView().current?.track.id);
  expect(await playing()).toBe("fHI8X4OXluQ");
  const tour = page.getByRole("dialog", { name: "Getting to know the scene" });
  await tour.waitFor({ timeout: 10_000 });
  await tour.getByRole("button", { name: "Next" }).click();
  await page.getByText("This button brings karaoke back.", { exact: false }).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "tour-switch.png") });
  await tour.getByRole("button", { name: "Next" }).click();
  await page.locator("[data-tour=scene-edit]").click();
  await page.getByRole("dialog", { name: "Scene studio" }).waitFor({ timeout: 10_000 });
  for (let step = 0; step < 5; step++) {
    await page.waitForTimeout(400);
    if (step === 1) await page.screenshot({ path: path.join(import.meta.dirname, "..", "artifacts", "ui", "visual", "tour-player.png") });
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await page.locator("[data-tour=studio-use]").click();
  await tour.waitFor({ state: "detached", timeout: 10_000 });
  await expect.poll(playing, { timeout: 5_000 }).toBe(track.id);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nuvo.visual") ?? "{}").toured)).toBe(true);
});
