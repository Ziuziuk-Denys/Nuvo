import type { Line } from "@/lyrics";
import { cachedAudio } from "@/features/sound/measureLoudness";
import { pitchShifter } from "@/engine/compat";
import { renderWithEffects, wavBytes, type SoundEffects } from "@/engine/audio/renderOffline";
import { loadCover, type LoadedCover } from "@/visual/cover";
import { downmix } from "@/visual/signal/offline";
import { peaks } from "@/visual/signal/peaks";
import { bitrateFor, frameSize, renderClip, type Backdrop, type Quality } from "@/visual/export";
import { createLive, type Live, type Media } from "@/visual/live";
import { SHADERS } from "@/visual/render/shaders/library";
import type { Part, Selection, Slot } from "@/visual/template/compose";
import { pickTemplate } from "@/visual/template/pick";
import { partsFor, sceneOf, WEIGHT_BUDGET, type Scene } from "@/visual/template/scene";
import type { Aspect, Template } from "@/visual/template/schema";
import { DEFAULT_TEMPLATE, PRESETS, SCENES, TEMPLATES } from "@/visual/template/templates";
import { strip, thumbnail } from "@/visual/thumbs";
import { lyricsCommands } from "./lyrics";
import { usePlayerStore } from "./player";
import { subscribeSpectrum } from "./sound";

export type { Quality };
export { LUMA_COLS, LUMA_ROWS } from "@/visual/render/stage";
export { drawWatermark } from "@/visual/watermark";
export { TEXT_SIZE, textLookOf, type TextInk, type TextLook } from "@/visual/template/text";
const AUDIO_BITS = 192_000;

export function clipEstimate(aspect: Aspect, quality: Quality, fps: number, lenMs: number): { width: number; height: number; bytes: number } {
  const { width, height } = frameSize(aspect, quality);
  return { width, height, bytes: Math.round(((bitrateFor(width, height, fps) + AUDIO_BITS) * lenMs) / 8_000) };
}
export type { Aspect, Live, Media, Part, Scene, Selection, Slot, Template };
export { partsFor, sceneOf, SCENES, WEIGHT_BUDGET };

export const VISUAL_TEMPLATES: Template[] = [...TEMPLATES, ...PRESETS];
const WHOLE_STEPS = new Set(["count", "levels", "lines", "thorns"]);

export function templateFor(choice: string, trackKey: string, hasWordTiming: boolean, scene: Selection | null): Template {
  if (choice === "own" && scene) return sceneOf(scene).template;
  // random mode deals only the curated scenes, never the early study templates
  if (choice === "random") return trackKey ? pickTemplate(trackKey, PRESETS, hasWordTiming) : PRESETS[0];
  return VISUAL_TEMPLATES.find((template) => template.id === choice) ?? DEFAULT_TEMPLATE;
}

const DECODE_RETRY_MS = 3_000;

export function createLiveStage(canvas: HTMLCanvasElement, clock?: () => { atMs: number; playing: boolean }): Live | null {
  if (clock) return createLive(canvas, { subscribe: subscribeSpectrum, clock });
  let wanted = "";
  let song: { pcm: Float32Array; sampleRate: number } | null = null;
  let retry: number | undefined;
  const load = (trackId: string) => {
    trackAudio(trackId).then(
      ({ pcm, sampleRate }) => {
        if (wanted === trackId) song = { pcm, sampleRate };
      },
      () => {
        // a streamed song reaches the cache a little after it starts
        if (wanted === trackId) retry = window.setTimeout(() => load(trackId), DECODE_RETRY_MS);
      },
    );
  };
  const follow = () => {
    const trackId = usePlayerStore.getState().currentTrack?.id ?? "";
    if (trackId === wanted) return;
    wanted = trackId;
    song = null;
    window.clearTimeout(retry);
    if (trackId) load(trackId);
  };
  const live = createLive(canvas, { subscribe: subscribeSpectrum, clock: () => lyricsCommands.clock(), decoded: () => song });
  if (!live) return null;
  follow();
  const unsubscribe = usePlayerStore.subscribe(follow);
  return {
    ...live,
    dispose() {
      unsubscribe();
      window.clearTimeout(retry);
      live.dispose();
    },
  };
}

export interface Control {
  key: string;
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export function controlsOf(part: Part, selection: Selection): Control[] {
  return (part.controls ?? []).map((key) => {
    const [shader, name] = key.split(".");
    const spec = SHADERS[shader].params[name];
    const own = part.layers.find((layer) => layer.shader === shader)?.params[name];
    const base = typeof own === "number" ? own : (own?.base ?? spec.value);
    const step = WHOLE_STEPS.has(name) ? 1 : (spec.max - spec.min) / 100;
    return { key, name, min: spec.min, max: spec.max, step, value: selection.params?.[part.id]?.[key] ?? base };
  });
}

function showcase(part: Part): Selection {
  const empty: Selection = { background: "night", atmosphere: [], centrepiece: null, lyrics: null };
  if (part.slot === "background") return { ...empty, background: part.id, lyrics: part.drawsText ? null : "line" };
  if (part.slot === "atmosphere") return { ...empty, atmosphere: [part.id] };
  if (part.slot === "centrepiece") return { ...empty, centrepiece: part.id };
  return { ...empty, background: part.requires?.[0] ?? "night", lyrics: part.id };
}

const covers = new Map<string, Promise<LoadedCover | null>>();

function coverOf(coverUrl: string): Promise<LoadedCover | null> {
  if (!covers.has(coverUrl)) covers.set(coverUrl, coverUrl ? loadCover(coverUrl).catch(() => null) : Promise.resolve(null));
  return covers.get(coverUrl)!;
}

export function thumbnailOf(part: Part, coverUrl: string): Promise<string> {
  return coverOf(coverUrl).then((cover) => thumbnail(sceneOf(showcase(part), `thumb-${part.id}`).template, cover));
}

export function sceneThumbnail(selection: Selection, id: string, coverUrl: string): Promise<string> {
  return coverOf(coverUrl).then((cover) => thumbnail(sceneOf(selection, `scene-${id}`).template, cover));
}

export function templateThumbnail(template: Template, coverUrl: string): Promise<string> {
  return coverOf(coverUrl).then((cover) => thumbnail(template, cover));
}

interface TrackAudio {
  trackId: string;
  work: Promise<{ pcm: Float32Array; sampleRate: number; peaks: number[]; durationMs: number }>;
}

const PEAK_BINS = 260;
// the live tap's rate, so offline features match live ones
const ANALYSIS_RATE = 48_000;
let audio: TrackAudio | null = null;

function trackAudio(trackId: string): TrackAudio["work"] {
  if (audio?.trackId !== trackId) {
    const work = cachedAudio(trackId)
      .then((blob) => blob.arrayBuffer())
      .then((data) => new OfflineAudioContext(1, 1, ANALYSIS_RATE).decodeAudioData(data))
      .then((buffer) => {
        const pcm = downmix(buffer);
        return { pcm, sampleRate: buffer.sampleRate, peaks: peaks(pcm, PEAK_BINS), durationMs: buffer.duration * 1000 };
      });
    const entry = { trackId, work };
    work.catch(() => {
      if (audio === entry) audio = null;
    });
    audio = entry;
  }
  return audio.work;
}

export function trackPeaks(trackId: string): Promise<{ peaks: number[]; durationMs: number }> {
  return trackAudio(trackId).then(({ peaks: bins, durationMs }) => ({ peaks: bins, durationMs }));
}

export interface FilmstripRequest {
  trackId: string;
  template: Template;
  aspect: Aspect;
  coverUrl: string;
  lines: Line[];
  timesMs: number[];
  height: number;
}

export async function filmstripOf(request: FilmstripRequest): Promise<string[]> {
  const [{ pcm, sampleRate }, cover] = await Promise.all([trackAudio(request.trackId), coverOf(request.coverUrl)]);
  return strip({ ...request, cover, pcm, sampleRate });
}

export interface ClipRequest {
  trackId: string;
  name: string;
  template: Template;
  aspect: Aspect;
  quality: Quality;
  fps: number;
  fadeMs: number;
  fromMs: number;
  lenMs: number;
  lines: Line[];
  coverUrl: string;
  media: Media | null;
}

export type ClipResult = { path: string } | { error: string } | null;

async function backdropOf(media: Media | null): Promise<((clipMs: number) => Promise<Backdrop>) | null> {
  if (!media) return null;
  if (media.kind === "image") {
    const image = new Image();
    image.src = media.url;
    await image.decode();
    const still = { source: image, width: image.naturalWidth, height: image.naturalHeight };
    return () => Promise.resolve(still);
  }
  const video = Object.assign(document.createElement("video"), { src: media.url, muted: true, preload: "auto" });
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = reject;
  });
  // the clip shows the video from its start and loops it, the way the live stage plays it
  return async (clipMs) => {
    const target = (clipMs / 1000) % video.duration;
    if (Math.abs(video.currentTime - target) > 0.001) {
      const seeked = new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
      video.currentTime = target;
      await seeked;
    }
    return { source: video, width: video.videoWidth, height: video.videoHeight };
  };
}

async function soundedClip(request: ClipRequest, effects: SoundEffects): Promise<Uint8Array> {
  const data = await (await cachedAudio(request.trackId)).arrayBuffer();
  const song = await new OfflineAudioContext(2, 1, ANALYSIS_RATE).decodeAudioData(data);
  const rendered = await renderWithEffects(song, request.fromMs, request.lenMs, effects, request.fadeMs, Math.random);
  return wavBytes([rendered.getChannelData(0), rendered.getChannelData(1)], rendered.sampleRate);
}

export async function exportClip(request: ClipRequest, onProgress: (done: number) => void, signal: AbortSignal): Promise<ClipResult> {
  const shell = window.nuvoShell;
  if (!shell) return { error: "export needs the desktop app" };
  const begun = await shell.clipBegin(request.name);
  if (!begun) return null;
  try {
    const effects = pitchShifter.effects(request.trackId);
    const [{ pcm, sampleRate }, cover, backdrop, sound] = await Promise.all([
      trackAudio(request.trackId),
      coverOf(request.coverUrl),
      backdropOf(request.media),
      soundedClip(request, effects),
    ]);
    if (!(await shell.clipAudio(begun.id, sound))) throw new Error("the clip's sound could not be written");
    await renderClip(
      { ...request, pcm, sampleRate, cover, backdrop, speed: effects.tempo.rate },
      async (bytes) => {
        if (!(await shell.clipWrite(begun.id, bytes))) throw new Error("the clip could not be written");
      },
      onProgress,
      signal,
    );
    return await shell.clipFinish({
      id: begun.id,
      trackId: request.trackId,
      startMs: Math.round(request.fromMs),
      lenMs: Math.round(request.lenMs),
      fps: request.fps,
      fadeMs: Math.round(request.fadeMs),
    });
  } catch (error) {
    await shell.clipCancel(begun.id);
    if (signal.aborted) return null;
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
