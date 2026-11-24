import { useEffect, useState } from "react";
import { cachedAudio } from "./measureLoudness";

export const SHAPE_BINS = 300;
const SMOOTH_S = 2.4;
const SHAPE_RATE = 8_000;
const FLOOR_DB = -24;
const CONTRAST = 2;
const KEPT = 60;
const RETRY_MS = 6_000;
const MAX_TRIES = 6;

export function loudnessShape(channels: Float32Array[], bins = SHAPE_BINS): number[] {
  const length = channels[0]?.length ?? 0;
  const size = Math.max(1, Math.floor(length / bins));
  const powers = Array.from({ length: bins }, (_, bin) => {
    let sum = 0;
    for (const channel of channels) {
      for (let i = bin * size, end = Math.min(length, i + size); i < end; i++) sum += channel[i] * channel[i];
    }
    return sum;
  });
  const loudest = Math.max(...powers);
  if (loudest === 0) return powers;
  return powers.map((power) => (power > 0 ? Math.max(0, 1 - (10 * Math.log10(power / loudest)) / FLOOR_DB) ** CONTRAST : 0));
}

export function smooth(shape: number[], radius: number): number[] {
  const box = (values: number[]) =>
    values.map((_, at) => {
      const near = values.slice(Math.max(0, at - radius), at + radius + 1);
      return near.reduce((sum, value) => sum + value, 0) / near.length;
    });
  return radius > 0 ? box(box(shape)) : shape;
}

// the quiet and loud ends of one song fill the line, unless the song holds one level
export function stretch(shape: number[]): number[] {
  const low = Math.min(...shape);
  const span = Math.max(...shape) - low;
  return span < 0.08 ? shape : shape.map((value) => 0.06 + (0.94 * (value - low)) / span);
}

const shapes = new Map<string, number[]>();

async function measure(trackId: string): Promise<number[]> {
  const data = await (await cachedAudio(trackId)).arrayBuffer();
  const shape = await new OfflineAudioContext(1, 1, SHAPE_RATE).decodeAudioData(data).then(
    (buffer) => {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      return stretch(smooth(loudnessShape(channels), Math.round((SMOOTH_S / 2 / buffer.duration) * SHAPE_BINS)));
    },
    () => [],
  );
  shapes.set(trackId, shape);
  if (shapes.size > KEPT) shapes.delete(shapes.keys().next().value!);
  return shape;
}

// a song still streaming has no cached file yet, so its shape arrives once the file does
export function useLoudnessShape(trackId: string | null, visible: boolean): number[] | null {
  const [loaded, setLoaded] = useState<{ id: string; shape: number[] } | null>(null);
  const kept = trackId ? shapes.get(trackId) : undefined;

  useEffect(() => {
    if (!trackId || !visible || shapes.has(trackId) || typeof OfflineAudioContext === "undefined") return;
    let live = true;
    let tries = 0;
    let timer: number | undefined;
    const run = () => {
      measure(trackId).then(
        (shape) => {
          if (live) setLoaded({ id: trackId, shape });
        },
        () => {
          tries += 1;
          if (live && tries < MAX_TRIES) timer = window.setTimeout(run, RETRY_MS * 2 ** (tries - 1));
        },
      );
    };
    timer = window.setTimeout(run, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [trackId, visible]);

  return kept ?? (loaded && loaded.id === trackId ? loaded.shape : null);
}
