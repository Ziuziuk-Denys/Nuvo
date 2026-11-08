import { CORE_BASE_URL } from "@/data/core/request";
import { mixCardColors, useCoverColors } from "@/data/covers/colors";
import { coverUrl } from "@/data/covers/coverUrl";

/** The cover at the size it is drawn (CSS pixels times the device pixel ratio), from the daemon's cover cache. */
export function coverSrc(src: string, cssPx: number, dpr: number): string {
  return coverUrl(CORE_BASE_URL, src, cssPx, dpr);
}

/** The daemon URL for a cover: the 512 bucket, or the bucket for a given size in CSS pixels. Not a hook despite its name. */
export function useCoverSrc(src: string | undefined, cssPx?: number): string | undefined {
  if (!src) return undefined;
  return (cssPx === undefined ? coverSrc(src, 512, 1) : coverSrc(src, cssPx, globalThis.devicePixelRatio ?? 1)) || undefined;
}

/** Colours read from a small copy of the cover; the read needs the daemon URL. */
const SAMPLE_PX = 64;

/** The mix card's shade colour and the colour of its mark, from its first cover. */
export function useCoverFluidColors(src: string | undefined): { color1: string; logoColor: string } {
  return mixCardColors(useCoverColors(src ? coverSrc(src, SAMPLE_PX, 1) : undefined));
}
