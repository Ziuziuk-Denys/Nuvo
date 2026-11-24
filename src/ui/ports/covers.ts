import { CORE_BASE_URL } from "@/data/core/request";
import { mixCardColors, readCoverPixels, useCoverColors } from "@/data/covers/colors";
import { coverUrl } from "@/data/covers/coverUrl";

export { colorsFor, useCoverColors } from "@/data/covers/colors";

export function coverSrc(src: string, cssPx: number, dpr: number): string {
  return coverUrl(CORE_BASE_URL, src, cssPx, dpr);
}

// Daemon URL for a cover; not a hook despite its name
export function useCoverSrc(src: string | undefined, cssPx?: number): string | undefined {
  if (!src) return undefined;
  return (cssPx === undefined ? coverSrc(src, 512, 1) : coverSrc(src, cssPx, globalThis.devicePixelRatio ?? 1)) || undefined;
}

const SAMPLE_PX = 64;

export function useCoverFluidColors(src: string | undefined): { color1: string; logoColor: string } {
  return mixCardColors(useCoverColors(src ? coverSrc(src, SAMPLE_PX, 1) : undefined));
}

export function coverPixels(src: string): Promise<Uint8ClampedArray> {
  return readCoverPixels(coverSrc(src, SAMPLE_PX, 1));
}
