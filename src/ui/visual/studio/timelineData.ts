import { useEffect, useReducer, useState } from "react";
import type { Line } from "../../ports/lyrics";
import { filmstripOf, trackPeaks, type Aspect, type Media, type Template } from "../../ports/visual";

const STRIP_DEBOUNCE_MS = 300;
const STRIP_RETRY_MS = 2_000;
export const STRIP_HEIGHT = 64;

export function useWave(trackId: string): number[] {
  const [wave, setWave] = useState<number[]>([]);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    trackPeaks(trackId).then(
      (result) => {
        if (live) setWave(result.peaks);
      },
      () => {
        if (live) timer = window.setTimeout(retry, STRIP_RETRY_MS);
      },
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [trackId, attempt]);
  return wave;
}

export interface StripTile {
  startMs: number;
  endMs: number;
  url: string | null;
}

interface StripRequest {
  trackId: string;
  template: Template;
  aspect: Aspect;
  coverUrl: string;
  media: Media | null;
  lines: Line[];
  fromMs: number;
  toMs: number;
  count: number;
}

const disposed = new WeakSet<Map<number, string>>();

// tiles sit on a fixed grid of moments, so panning and following the playhead reuse them
export function useFilmstrip({ trackId, template, aspect, coverUrl, media, lines, fromMs, toMs, count }: StripRequest): StripTile[] {
  const step = count > 0 ? Math.max(1, Math.round((toMs - fromMs) / count)) : 0;
  // anything that changes how a frame looks starts a fresh set of tiles
  const inputs = [trackId, template, aspect, coverUrl, media, lines, step] as const;
  const [cache, setCache] = useState(() => ({ inputs, tiles: new Map<number, string>() }));
  if (inputs.some((value, i) => value !== cache.inputs[i])) setCache({ inputs, tiles: new Map() });
  const store = cache.tiles;
  // a redraw shows new tiles; a failed load (the song not cached yet) tries again after a pause
  const [attempt, redraw] = useReducer((n: number) => n + 1, 0);
  const first = step ? Math.floor(fromMs / step) : 0;
  const last = step ? Math.ceil(toMs / step) : 0;

  useEffect(
    () => () => {
      disposed.add(store);
      store.forEach((url) => URL.revokeObjectURL(url));
    },
    [store],
  );

  useEffect(() => {
    if (!step) return;
    const missing: number[] = [];
    for (let k = first; k < last; k++) if (!store.has(k)) missing.push(k);
    if (missing.length === 0) return;
    const timer = window.setTimeout(() => {
      filmstripOf({
        trackId,
        template,
        aspect,
        coverUrl,
        media,
        lines,
        timesMs: missing.map((k) => (k + 0.5) * step),
        height: STRIP_HEIGHT * devicePixelRatio,
      }).then(
        (urls) => {
          if (disposed.has(store)) return urls.forEach((url) => URL.revokeObjectURL(url));
          missing.forEach((k, i) => store.set(k, urls[i]));
          redraw();
        },
        () => {
          retry = window.setTimeout(redraw, STRIP_RETRY_MS);
        },
      );
    }, STRIP_DEBOUNCE_MS);
    let retry: number | undefined;
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retry);
    };
  }, [store, first, last, step, trackId, template, aspect, coverUrl, media, lines, attempt]);

  const tiles: StripTile[] = [];
  for (let k = first; k < last; k++) tiles.push({ startMs: k * step, endMs: (k + 1) * step, url: store.get(k) ?? null });
  return tiles;
}
