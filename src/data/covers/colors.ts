import { useEffect, useState } from "react";
import { contrastRatio } from "@/data/color/contrast";

export interface CoverColors {
  color1: string;
  color2: string;
}

export const DEFAULT_COVER_COLORS: CoverColors = { color1: "rgb(24, 26, 32)", color2: "rgb(128, 144, 176)" };

const HUE_BINS = 12;
const MIN_CHROMA = 24;
const MIN_BRIGHTNESS = 32;
const SECOND_SHARE = 0.15;
const SAMPLE_PX = 32;
const RETRY_MS = 250;
const CACHED = 100;
/** A cover that neither loads nor fails must not hold its request open. */
const READ_TIMEOUT_MS = 3000;

interface Bin {
  weight: number;
  r: number;
  g: number;
  b: number;
}

function hueOf(r: number, g: number, b: number, max: number, chroma: number): number {
  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  return (hue * 60 + 360) % 360;
}

function mean(bin: Bin, scale = 1): string {
  const channel = (sum: number) => Math.round((sum / bin.weight) * scale);
  return `rgb(${channel(bin.r)}, ${channel(bin.g)}, ${channel(bin.b)})`;
}

function binDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % HUE_BINS;
  return Math.min(distance, HUE_BINS - distance);
}

export function pickCoverColors(pixels: Uint8ClampedArray): CoverColors | null {
  const bins: Bin[] = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  const all: Bin = { weight: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (pixels[i + 3] < 128) continue;
    all.weight += 1;
    all.r += r;
    all.g += g;
    all.b += b;
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);
    if (chroma < MIN_CHROMA || max < MIN_BRIGHTNESS) continue;
    const weight = (chroma / 255) * (max / 255);
    const bin = bins[Math.floor(hueOf(r, g, b, max, chroma) / (360 / HUE_BINS)) % HUE_BINS];
    bin.weight += weight;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  }
  if (all.weight === 0) return null;
  const ranked = bins
    .map((bin, index) => ({ bin, index }))
    .filter(({ bin }) => bin.weight > 0)
    .sort((a, b) => b.bin.weight - a.bin.weight);
  if (ranked.length === 0) return { color2: mean(all), color1: mean(all, 0.5) };
  const top = ranked[0];
  // a second colour counts only at least 60 degrees away and with some presence
  const second = ranked.find(({ bin, index }) => binDistance(index, top.index) >= 2 && bin.weight >= top.bin.weight * SECOND_SHARE);
  return { color2: mean(top.bin), color1: second ? mean(second.bin, 0.6) : mean(top.bin, 0.45) };
}

export function mixCardColors(colors: CoverColors): { color1: string; logoColor: string } {
  const readable = contrastRatio(colors.color2, "rgb(0, 0, 0)") >= 4.5;
  return { color1: colors.color1, logoColor: readable ? colors.color2 : "#fff" };
}

export type PixelReader = (url: string) => Promise<Uint8ClampedArray>;

export function createCoverColors(read: PixelReader) {
  const cache = new Map<string, CoverColors>();
  const pending = new Map<string, Promise<CoverColors>>();

  async function readWithRetry(url: string): Promise<CoverColors> {
    let pixels: Uint8ClampedArray;
    try {
      pixels = await read(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      pixels = await read(url);
    }
    return pickCoverColors(pixels) ?? DEFAULT_COVER_COLORS;
  }

  function withTimeout(work: Promise<CoverColors>): Promise<CoverColors> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("cover read timed out")), READ_TIMEOUT_MS);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  function colorsFor(url: string): Promise<CoverColors> {
    const known = cache.get(url);
    if (known) {
      cache.delete(url);
      cache.set(url, known);
      return Promise.resolve(known);
    }
    let request = pending.get(url);
    if (!request) {
      request = withTimeout(readWithRetry(url))
        .then(
          (colors) => {
            cache.set(url, colors);
            if (cache.size > CACHED) cache.delete(cache.keys().next().value!);
            return colors;
          },
          () => DEFAULT_COVER_COLORS,
        )
        .finally(() => pending.delete(url));
      pending.set(url, request);
    }
    return request;
  }

  function useCoverColors(url: string | undefined): CoverColors {
    const [shown, setShown] = useState<{ url: string | undefined; colors: CoverColors }>(() => ({
      url,
      colors: (url && cache.get(url)) || DEFAULT_COVER_COLORS,
    }));
    useEffect(() => {
      if (!url) return;
      let live = true;
      void colorsFor(url).then((colors) => {
        if (live) setShown({ url, colors });
      });
      return () => {
        live = false;
      };
    }, [url]);
    if (shown.url !== url) return (url && cache.get(url)) || DEFAULT_COVER_COLORS;
    return shown.colors;
  }

  return { colorsFor, useCoverColors };
}

// Daemon covers are readable because the bridge echoes the page origin
export async function readCoverPixels(url: string): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_PX;
  canvas.height = SAMPLE_PX;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas 2d context unavailable");
  context.drawImage(image, 0, 0, SAMPLE_PX, SAMPLE_PX);
  return context.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data;
}

export const { colorsFor, useCoverColors } = createCoverColors(readCoverPixels);
