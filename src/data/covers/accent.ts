import { hslToRgb, rgbToHsl } from "../color/hsl";

export const NEUTRAL_ACCENT = { light: "rgb(110, 110, 115)", dark: "rgb(170, 170, 176)" } as const;

const BUCKETS = 24;
const MIN_SHARE = 0.01;

export function coverAccent(pixels: Uint8ClampedArray, light: boolean): string {
  const weights = new Float64Array(BUCKETS);
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  let counted = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    counted += 1;
    const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (s < 0.25 || l < 0.12 || l > 0.9) continue;
    const bucket = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    const weight = s * (1 - Math.abs(l - 0.5));
    weights[bucket] += weight;
    sums[bucket][0] += pixels[i] * weight;
    sums[bucket][1] += pixels[i + 1] * weight;
    sums[bucket][2] += pixels[i + 2] * weight;
  }
  let best = 0;
  for (let bucket = 1; bucket < BUCKETS; bucket += 1) if (weights[bucket] > weights[best]) best = bucket;
  if (counted === 0 || weights[best] < counted * MIN_SHARE) return light ? NEUTRAL_ACCENT.light : NEUTRAL_ACCENT.dark;
  const [r, g, b] = sums[best].map((sum) => sum / weights[best]);
  const [h, s] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(h, Math.max(s, 0.45), light ? 0.42 : 0.66);
  return `rgb(${nr}, ${ng}, ${nb})`;
}
