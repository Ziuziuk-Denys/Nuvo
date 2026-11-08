import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchNuvo, SIZES, type NuvoSession } from "./harness";
import { diffRatio } from "./pixels";
import { coverDataUrl } from "./seed";

/**
 * The karaoke background on a real GPU: what one frame costs, and frames every 2 s of its own clock
 * for a side-by-side look with the observed view (e2e/artifacts/ui/karaoke-observed/background-*.png).
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FRAMES = path.join(ROOT, "e2e", "artifacts", "ui", "karaoke-backdrop");
/** Half of the 30 fps frame budget; the field must leave the rest of the frame to the view. */
const MAX_FRAME_MS = 1000 / 30 / 2;
let session: NuvoSession;

beforeAll(async () => {
  session = await launchNuvo({ profile: "fresh" });
});
afterAll(async () => session?.close());

it("draws the cover field within the frame budget", async () => {
  const page = session.page;
  fs.mkdirSync(FRAMES, { recursive: true });
  await session.setSize(SIZES[0]);
  await page.setViewportSize(SIZES[0]);
  const source = fs.readFileSync(path.join(ROOT, "src", "ui", "karaoke", "backdrop", "shader.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  await page.evaluate(`(() => { const exports = {}; ${js}; window.flowModule = exports; })()`);

  const cost = await page.evaluate(async (cover) => {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647";
    document.body.append(canvas);
    const module = (window as unknown as { flowModule: typeof import("../../src/ui/karaoke/backdrop/shader") }).flowModule;
    const renderer = module.createFlowRenderer(canvas);
    if (!renderer) return null;
    renderer.resize(canvas.clientWidth * devicePixelRatio * 0.5, canvas.clientHeight * devicePixelRatio * 0.5);
    const image = new Image();
    image.src = cover;
    await image.decode();
    renderer.setCover(image);
    const gl = canvas.getContext("webgl2")!;
    const start = performance.now();
    const pixel = new Uint8Array(4);
    // a read-back waits for the GPU, so the time covers the drawing itself, not just the queueing
    const timed = (frames: number) => {
      const before = performance.now();
      for (let i = 0; i < frames; i += 1) renderer.draw(start + i * 33);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return (performance.now() - before) / frames;
    };
    timed(10);
    const batches = Array.from({ length: 5 }, () => timed(60)).sort((a, b) => a - b);
    const single = Array.from({ length: 30 }, () => timed(1)).sort((a, b) => a - b);
    (window as unknown as { flowDraw: (t: number) => void }).flowDraw = (seconds: number) => renderer.draw(start + seconds * 1000);
    return {
      median: batches[2],
      singleMedian: single[15],
      singleWorst: single[29],
      backing: [canvas.width, canvas.height],
      gpu: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    };
  }, coverDataUrl(2));

  expect(cost, "WebGL2 is available").not.toBeNull();
  fs.writeFileSync(path.join(FRAMES, "cost.json"), `${JSON.stringify(cost, null, 2)}\n`);
  expect(cost!.backing).toEqual([SIZES[0].width / 2, SIZES[0].height / 2]);
  expect(cost!.median).toBeLessThan(MAX_FRAME_MS);

  const files: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.evaluate((seconds) => (window as unknown as { flowDraw: (t: number) => void }).flowDraw(seconds), i * 2);
    const file = path.join(FRAMES, `background-${String(i).padStart(2, "0")}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  // it moves, but slowly: in 2 s many pixels shift a little (the observed view: about 0.7 by more than 2 of 255), almost none by more than 32
  for (let i = 1; i < files.length; i += 1) {
    expect(await diffRatio(session.app, files[i - 1], files[i], 2)).toBeGreaterThan(0.15);
    expect(await diffRatio(session.app, files[i - 1], files[i], 32)).toBeLessThan(0.05);
  }
});
