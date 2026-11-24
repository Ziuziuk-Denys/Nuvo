import { useEffect, useState } from "react";
import { cachedAudio } from "./measureLoudness";

export const SHAPE_BINS = 360;
const SHAPE_RATE = 8_000;
const FLOOR_DB = -24;
const CONTRAST = 2.2;
const KEPT = 60;
const RETRY_MS = 6_000;
const MAX_TRIES = 20;

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

const shapes = new Map<string, number[]>();

async function measure(trackId: string): Promise<number[]> {
  const data = await (await cachedAudio(trackId)).arrayBuffer();
  const shape = await new OfflineAudioContext(1, 1, SHAPE_RATE).decodeAudioData(data).then(
    (buffer) => loudnessShape(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))),
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
          if (live && tries < MAX_TRIES) timer = window.setTimeout(run, RETRY_MS);
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
