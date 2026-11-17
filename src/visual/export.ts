import type { Line } from "@/lyrics";
import type { LoadedCover } from "./cover";
import { paint } from "./paint";
import { drawWatermark } from "./watermark";
import { DEFAULT_PALETTE } from "./render/palette";
import { createStage } from "./render/stage";
import { analyse } from "./signal/offline";
import type { Aspect, Template } from "./template/schema";
import { loadVisualFonts } from "./type/fonts";
import { createTextRaster } from "./type/raster";

export type Quality = "720p" | "1080p" | "2k" | "4k";
export const QUALITIES: Record<Quality, number> = { "720p": 720, "1080p": 1080, "2k": 1440, "4k": 2160 };

const LONG: Record<Aspect, number> = { tall: 16 / 9, wide: 16 / 9, square: 1 };
const even = (n: number) => Math.round(n / 2) * 2;

export function frameSize(aspect: Aspect, quality: Quality): { width: number; height: number } {
  const short = QUALITIES[quality];
  const long = even(short * LONG[aspect]);
  return aspect === "tall" ? { width: short, height: long } : { width: long, height: short };
}

export function bitrateFor(width: number, height: number, fps: number): number {
  return Math.round(Math.min(50_000_000, Math.max(6_000_000, width * height * fps * 0.11)));
}

// macroblocks per frame and per second for each H.264 level, smallest first
const LEVELS: [number, number, string][] = [
  [3600, 108_000, "1f"],
  [5120, 216_000, "20"],
  [8704, 522_240, "2a"],
  [22_080, 589_824, "32"],
  [36_864, 983_040, "33"],
  [36_864, 2_073_600, "34"],
];

export function codecsFor(width: number, height: number, fps: number): string[] {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = (LEVELS.find(([frame, rate]) => blocks <= frame && blocks * fps <= rate) ?? LEVELS.at(-1)!)[2];
  return ["6400", "4d00", "42e0"].map((profile) => `avc1.${profile}${level}`);
}

async function pickConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig | null> {
  for (const codec of codecsFor(width, height, fps)) {
    for (const hardwareAcceleration of ["prefer-hardware", "no-preference"] as const) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        framerate: fps,
        bitrate: bitrateFor(width, height, fps),
        bitrateMode: "variable",
        latencyMode: "quality",
        hardwareAcceleration,
        avc: { format: "annexb" },
      };
      const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
      if (support?.supported) return config;
    }
  }
  return null;
}

export function fadeAt(atMs: number, lenMs: number, fadeMs: number): number {
  const fade = Math.min(fadeMs, lenMs / 2);
  if (fade <= 0) return 1;
  const edge = Math.min(atMs, lenMs - atMs) / fade;
  const t = Math.max(0, Math.min(1, edge));
  return t * t * (3 - 2 * t);
}

export interface ClipJob {
  template: Template;
  aspect: Aspect;
  quality: Quality;
  fps: number;
  fromMs: number;
  lenMs: number;
  pcm: Float32Array;
  sampleRate: number;
  lines: Line[];
  cover: LoadedCover | null;
  fadeMs: number;
  speed: number;
  backdrop: ((clipMs: number) => Promise<Backdrop>) | null;
}

export interface Backdrop {
  source: TexImageSource;
  width: number;
  height: number;
}

const FLUSH_BYTES = 4 * 1024 * 1024;
const WARM_MS = 3_000;

export async function renderClip(
  job: ClipJob,
  sink: (bytes: Uint8Array) => Promise<void>,
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const { width, height } = frameSize(job.aspect, job.quality);
  const config = await pickConfig(width, height, job.fps);
  if (!config) throw new Error("this computer cannot encode H.264 at this size");
  await loadVisualFonts();
  const canvas = new OffscreenCanvas(width, height);
  const stage = createStage(canvas);
  if (!stage) throw new Error("WebGL2 is not available");
  const raster = createTextRaster(width, height);
  // every exported frame carries the watermark; the scene is copied under it on a 2D canvas the encoder reads
  const composer = new OffscreenCanvas(width, height);
  const composed = composer.getContext("2d");
  if (!composed) throw new Error("2D canvas is not available");
  stage.resize(width, height);
  stage.setTemplate(job.template, job.aspect);
  if (job.cover) stage.setCover(job.cover.bitmap, job.cover.palette);
  else stage.setCover(new ImageData(new Uint8ClampedArray([20, 22, 28, 255]), 1, 1), DEFAULT_PALETTE);
  let shown: TexImageSource | null = null;
  const showBackdrop = async (clipMs: number) => {
    if (!job.backdrop) return;
    const next = await job.backdrop(clipMs);
    // a video element stays the same object while its frame changes, so only a still image is skipped
    if (next.source === shown && !(next.source instanceof HTMLVideoElement)) return;
    shown = next.source;
    stage.setImage(next.source, next.width, next.height);
  };

  let parts: Uint8Array[] = [];
  let size = 0;
  let writing = Promise.resolve();
  let failure: unknown = null;
  const flush = () => {
    if (size === 0) return;
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    parts = [];
    size = 0;
    writing = writing.then(() => sink(bytes));
  };
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const part = new Uint8Array(chunk.byteLength);
      chunk.copyTo(part);
      parts.push(part);
      size += part.length;
      if (size >= FLUSH_BYTES) flush();
    },
    error: (error) => (failure = error),
  });
  encoder.configure(config);

  try {
    // springs, trails and feedback layers settle before the first frame that is kept
    const warmMs = Math.min(WARM_MS, job.fromMs);
    // song time runs at the player's speed: analysing at fps / speed gives one step per output frame
    const songFps = job.fps / job.speed;
    const songStepMs = 1000 / songFps;
    const outLenMs = job.lenMs / job.speed;
    const warm = Math.round((warmMs * songFps) / 1000);
    const frames = analyse(job.pcm, job.sampleRate, job.fromMs - warmMs, job.fromMs + job.lenMs, songFps);
    await showBackdrop(0);
    for (let i = 0; i < warm; i++) paint(stage, raster, job.template, job.aspect, job.lines, job.fromMs - warmMs + i * songStepMs, frames[i]);
    const kept = frames.slice(warm);
    const frameUs = 1_000_000 / job.fps;
    for (let i = 0; i < kept.length; i++) {
      if (signal.aborted) throw signal.reason ?? new DOMException("cancelled", "AbortError");
      if (failure) throw failure;
      await showBackdrop((i * 1000) / job.fps);
      paint(stage, raster, job.template, job.aspect, job.lines, job.fromMs + i * songStepMs, kept[i]);
      composed.drawImage(canvas, 0, 0);
      const visible = fadeAt((i * 1000) / job.fps, outLenMs, job.fadeMs);
      if (visible < 1) {
        composed.fillStyle = `rgba(0, 0, 0, ${1 - visible})`;
        composed.fillRect(0, 0, width, height);
      }
      drawWatermark(composed, width, height);
      const frame = new VideoFrame(composer, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (job.fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 3) await new Promise((resolve) => setTimeout(resolve, 1));
      if (i % 15 === 0) onProgress(i / kept.length);
    }
    await encoder.flush();
    if (failure) throw failure;
    flush();
    await writing;
    onProgress(1);
  } finally {
    if (encoder.state !== "closed") encoder.close();
    stage.dispose();
  }
}
