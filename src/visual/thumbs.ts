import type { Line } from "@/lyrics";
import type { LoadedCover } from "./cover";
import { paint } from "./paint";
import { DEFAULT_PALETTE } from "./render/palette";
import { createStage, type Stage } from "./render/stage";
import { BANDS, WAVE, type Features } from "./signal/features";
import { analyse } from "./signal/offline";
import type { Aspect, Template } from "./template/schema";
import { loadVisualFonts } from "./type/fonts";
import { createTextRaster } from "./type/raster";

const WIDTH = 108;
const HEIGHT = 192;
const FRAMES = 48;
const STRIP_WARM_MS = 300;
const STRIP_WARM_FPS = 30;
const ASPECT_RATIO: Record<Aspect, number> = { tall: 9 / 16, square: 1, wide: 16 / 9 };
const SAMPLE: Line[] = [{ fromMs: 0, toMs: 4_000, text: "Feel the music move", companion: false, instrumental: false }];

let canvas: OffscreenCanvas | null = null;
let stage: Stage | null = null;
let queue: Promise<unknown> = Promise.resolve();

function features(frame: number): Features {
  const beat = frame % 12 === 0;
  const bands = new Float32Array(BANDS);
  for (let i = 0; i < BANDS; i++) bands[i] = 0.55 + 0.35 * Math.abs(Math.sin(i * 0.37 + frame * 0.21));
  return {
    bands,
    bass: 0.7,
    mid: 0.5,
    high: 0.35,
    level: 0.7,
    flux: beat ? 0.8 : 0.1,
    onset: beat ? 1 : 0,
    beat: (frame % 12) / 12,
    beatConfidence: 1,
    beatMs: 400,
    wave: new Float32Array(WAVE).map((_, i) => 0.4 * Math.sin(i * 0.11 + frame)),
  };
}

async function prepared(
  template: Template,
  aspect: Aspect,
  cover: LoadedCover | null,
  still: ImageBitmap | null,
  width: number,
  height: number,
): Promise<{ stage: Stage; canvas: OffscreenCanvas } | null> {
  await loadVisualFonts();
  canvas ??= new OffscreenCanvas(width, height);
  stage ??= createStage(canvas);
  if (!stage) return null;
  stage.resize(width, height);
  stage.setTemplate(template, aspect);
  stage.reset();
  if (cover) stage.setCover(cover.bitmap, cover.palette);
  else stage.setCover(new ImageData(new Uint8ClampedArray([40, 44, 56, 255]), 1, 1), DEFAULT_PALETTE);
  stage.setImage(still, still?.width ?? 1, still?.height ?? 1);
  return { stage, canvas };
}

const snapshot = async (target: OffscreenCanvas) => URL.createObjectURL(await target.convertToBlob({ type: "image/jpeg", quality: 0.86 }));

async function draw(template: Template, cover: LoadedCover | null, still: ImageBitmap | null): Promise<string> {
  const ready = await prepared(template, "tall", cover, still, WIDTH, HEIGHT);
  if (!ready) return "";
  const raster = createTextRaster(WIDTH * 2, HEIGHT * 2);
  for (let frame = 0; frame < FRAMES; frame++) paint(ready.stage, raster, template, "tall", SAMPLE, 1_200 + frame * (1000 / 60), features(frame));
  return snapshot(ready.canvas);
}

export interface StripRequest {
  template: Template;
  aspect: Aspect;
  cover: LoadedCover | null;
  still: ImageBitmap | null;
  lines: Line[];
  pcm: Float32Array;
  sampleRate: number;
  timesMs: number[];
  height: number;
}

async function drawStrip(request: StripRequest): Promise<string[]> {
  const height = Math.round(request.height);
  const width = Math.round((height * ASPECT_RATIO[request.aspect]) / 2) * 2;
  const ready = await prepared(request.template, request.aspect, request.cover, request.still, width, height);
  if (!ready) return [];
  const raster = createTextRaster(width * 2, height * 2);
  const frames: string[] = [];
  for (const timeMs of request.timesMs) {
    ready.stage.reset();
    const fromMs = Math.max(0, timeMs - STRIP_WARM_MS);
    analyse(request.pcm, request.sampleRate, fromMs, timeMs, STRIP_WARM_FPS).forEach((step, index) =>
      paint(ready.stage, raster, request.template, request.aspect, request.lines, fromMs + (index * 1000) / STRIP_WARM_FPS, step),
    );
    frames.push(await snapshot(ready.canvas));
    // one frame per task, so the live preview keeps its frame rate while the strip fills in
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return frames;
}

function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
}

export function thumbnail(template: Template, cover: LoadedCover | null, still: ImageBitmap | null): Promise<string> {
  return queued(() => draw(template, cover, still));
}

export function strip(request: StripRequest): Promise<string[]> {
  return queued(() => drawStrip(request));
}
