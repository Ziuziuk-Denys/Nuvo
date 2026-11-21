/// <reference lib="webworker" />
import type { Line } from "@/lyrics";
import { createGovernor } from "./governor";
import { DISPLAY_LEAD_MS, paint } from "./paint";
import { DEFAULT_PALETTE } from "./render/palette";
import { SHADERS } from "./render/shaders/library";
import { createStage, type Stage } from "./render/stage";
import { createExtractor, WINDOW } from "./signal/features";
import { createSongFeatures, type SongFeatures } from "./signal/songFeatures";
import { windowAt } from "./signal/offline";
import { createStageClock } from "./stageClock";
import { sharedNow, type FromStage, type ToStage } from "./stageProtocol";
import type { Aspect, Template } from "./template/schema";
import { loadVisualFonts } from "./type/fonts";
import { createTextRaster, type TextRaster } from "./type/raster";

declare const self: DedicatedWorkerGlobalScope;

const FOOT_EVERY_MS = 500;
const FOOT_WIDTH = 16;
const FOOT_DARKEN = 0.38;
const LUMA_STEP = 6;
const LIGHT_ABOVE = 0.62;
const DARK_BELOW = 0.5;

// the live stage draws off the page's thread, so a busy page never holds back a frame or a word
let canvas: OffscreenCanvas | null = null;
let stage: Stage | null = null;
let raster: TextRaster | null = null;
let template: Template | null = null;
let aspect: Aspect = "wide";
let lines: Line[] = [];
let reduced = false;
let features: SongFeatures | null = null;
let rate = 0;
let song: { pcm: Float32Array; sampleRate: number } | null = null;
let tap: { wave: Float32Array; sampleRate: number } | null = null;
let mirror: OffscreenCanvasRenderingContext2D | null = null;
let foot: OffscreenCanvasRenderingContext2D | null = null;
let size = { width: 1, height: 1 };
let dirty = true;
let drawnAtMs = Number.NaN;
let lastFrame: number | null = null;
let lastFoot = 0;
let light = false;
let lastCells: Uint8Array | null = null;
let frames = 0;
let frameId: number | null = null;
const clock = createStageClock();
const governor = createGovernor();
const songWindow = new Float32Array(WINDOW);
const unprepared = Object.keys(SHADERS);

function applySize(): void {
  if (!stage) return;
  const width = Math.max(1, Math.round(size.width * governor.scale));
  const height = Math.max(1, Math.round(size.height * governor.scale));
  stage.resize(width, height);
  raster = createTextRaster(width, height);
  dirty = true;
}

const SILENCE = { wave: new Float32Array(WINDOW), sampleRate: 48_000 };

function draw(atMs: number): void {
  if (!stage || !template) return;
  // before any sound arrives the scene still draws, on silence
  const heard = tap && tap.wave.length >= WINDOW ? tap : SILENCE;
  const sampleRate = song?.sampleRate ?? heard.sampleRate;
  if (!features || rate !== sampleRate) {
    rate = sampleRate;
    features = createSongFeatures(createExtractor(rate));
  }
  // the decoded song never stalls and matches export; the tap covers the seconds before it is decoded
  const input = song ? windowAt(song.pcm, song.sampleRate, atMs, songWindow) : heard.wave.subarray(heard.wave.length - WINDOW);
  paint(stage, raster, template, aspect, lines, atMs, features.at(input, atMs), { reduced, displayLeadMs: DISPLAY_LEAD_MS });
}

function shareFoot(now: number): void {
  if (!mirror || !foot || now - lastFoot < FOOT_EVERY_MS) return;
  lastFoot = now;
  const source = mirror.canvas;
  foot.drawImage(source, 0, source.height - 1, source.width, 1, 0, 0, FOOT_WIDTH, 1);
  const row = foot.getImageData(0, 0, FOOT_WIDTH, 1).data;
  const rgb = [0, 1, 2].map((channel) => {
    let total = 0;
    for (let x = 0; x < FOOT_WIDTH; x++) total += row[x * 4 + channel];
    return Math.round((total / FOOT_WIDTH) * FOOT_DARKEN);
  }) as [number, number, number];
  self.postMessage({ type: "foot", rgb } satisfies FromStage);
}

// a gap between the two thresholds keeps a frame near the middle from flipping the controls back and forth
function shareLuma(fresh: boolean): void {
  const cells = stage?.luma(fresh);
  if (!cells) return;
  let total = 0;
  let moved = !lastCells;
  for (let i = 0; i < cells.length; i++) {
    total += cells[i];
    if (lastCells && Math.abs(cells[i] - lastCells[i]) >= LUMA_STEP) moved = true;
  }
  const mean = total / cells.length / 255;
  const next = light ? mean > DARK_BELOW : mean > LIGHT_ABOVE;
  if (next !== light) {
    light = next;
    self.postMessage({ type: "tone", light } satisfies FromStage);
  }
  if (!moved) return;
  lastCells = cells;
  self.postMessage({ type: "luma", cells } satisfies FromStage);
}

function loop(now: number): void {
  frameId = self.requestAnimationFrame(loop);
  if (lastFrame !== null && governor.frame(now - lastFrame) !== null) applySize();
  lastFrame = now;
  const { atMs, playing } = clock.read(sharedNow());
  // a paused song holds its frame; only a seek or a change to the scene draws again
  if (!playing && !dirty && atMs === drawnAtMs) {
    shareLuma(false);
    prepareOne();
    return;
  }
  dirty = false;
  drawnAtMs = atMs;
  draw(atMs);
  shareLuma(true);
  if (mirror && canvas && frames++ % 2 === 0) {
    mirror.drawImage(canvas, 0, 0, mirror.canvas.width, mirror.canvas.height);
    shareFoot(now);
  }
}

// shaders compile one per quiet frame, so a scene or song change never waits on the driver
function prepareOne(): void {
  const shader = unprepared.pop();
  if (shader && stage) stage.prepare(shader);
}

function start(target: OffscreenCanvas): void {
  canvas = target;
  stage = createStage(target);
  if (!stage) return;
  stage.setCover(new ImageData(new Uint8ClampedArray([20, 22, 28, 255]), 1, 1), DEFAULT_PALETTE);
  void loadVisualFonts().then(() => (dirty = true));
  applySize();
  frameId = self.requestAnimationFrame(loop);
}

// the texture keeps the picture, so the frame is closed at once and video decoding never runs out of frames
function replaceImage(next: ImageBitmap | VideoFrame | null, width: number, height: number): void {
  stage?.setImage(next, width, height);
  next?.close();
  dirty = true;
}

self.onmessage = (event: MessageEvent<ToStage>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      reduced = message.reduced;
      start(message.canvas);
      break;
    case "mirror":
      mirror = message.canvas.getContext("2d");
      foot = new OffscreenCanvas(FOOT_WIDTH, 1).getContext("2d", { willReadFrequently: true });
      break;
    case "template":
      template = message.template;
      aspect = message.aspect;
      stage?.setTemplate(message.template, message.aspect);
      stage?.setText(null);
      dirty = true;
      break;
    case "cover":
      stage?.setCover(message.bitmap, message.palette);
      message.bitmap.close();
      dirty = true;
      break;
    case "lyrics":
      lines = message.lines;
      dirty = true;
      break;
    case "image":
      replaceImage(message.source, message.width, message.height);
      break;
    case "song":
      song = message.pcm ? { pcm: message.pcm, sampleRate: message.sampleRate } : null;
      break;
    case "tap":
      tap = { wave: message.wave, sampleRate: message.sampleRate };
      break;
    case "clock":
      clock.sample(message);
      break;
    case "size":
      size = { width: message.width, height: message.height };
      applySize();
      break;
    case "motion":
      reduced = message.reduced;
      dirty = true;
      break;
    case "dispose":
      if (frameId !== null) self.cancelAnimationFrame(frameId);
      stage?.dispose();
      self.close();
      break;
  }
};
