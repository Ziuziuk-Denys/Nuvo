export type Rgb = [number, number, number];

export interface Palette {
  deep: Rgb;
  key: Rgb;
  cool: Rgb;
  light: Rgb;
}

export const DEFAULT_PALETTE: Palette = {
  deep: [0.035, 0.04, 0.06],
  key: [0.16, 0.59, 1],
  cool: [0.3, 0.36, 0.52],
  light: [0.93, 0.94, 0.96],
};

const HUE_BINS = 12;
const MIN_CHROMA = 0.12;
const MIN_COOL_SHARE = 0.15;
const DEEP_MAX = 0.035;
const LIGHT_MIN = 0.65;
const EDGE_SHARE = 0.15;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function withLuminance(colour: Rgb, target: number): Rgb {
  const linear = colour.map(toLinear) as Rgb;
  const current = luminance(colour);
  if (current <= 0) return [target, target, target].map(toSrgb) as Rgb;
  const scaled = linear.map((c) => Math.min(1, (c * target) / current)) as Rgb;
  const reached = 0.2126 * scaled[0] + 0.7152 * scaled[1] + 0.0722 * scaled[2];
  const towardWhite = reached < target ? (target - reached) / (1 - reached) : 0;
  return scaled.map((c) => toSrgb(c + (1 - c) * towardWhite)) as Rgb;
}

function average(pixels: Rgb[]): Rgb {
  const sum: Rgb = [0, 0, 0];
  for (const [r, g, b] of pixels) {
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
  }
  return sum.map((c) => c / pixels.length) as Rgb;
}

function hueBin([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  if (hue < 0) hue += 6;
  return Math.floor((hue / 6) * HUE_BINS) % HUE_BINS;
}

const binGap = (a: number, b: number) => Math.min(Math.abs(a - b), HUE_BINS - Math.abs(a - b));
const mix = (a: Rgb, b: Rgb, t: number) => a.map((c, i) => c + (b[i] - c) * t) as Rgb;

export function paletteFrom(pixels: Uint8ClampedArray): Palette {
  const colours: Rgb[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 127) colours.push([pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255]);
  }
  if (colours.length === 0) return DEFAULT_PALETTE;

  const byLuminance = colours.map((colour) => ({ colour, lum: luminance(colour) })).sort((a, b) => a.lum - b.lum);
  const edge = Math.max(1, Math.round(colours.length * EDGE_SHARE));
  const darkest = average(byLuminance.slice(0, edge).map((entry) => entry.colour));
  const lightest = average(byLuminance.slice(-edge).map((entry) => entry.colour));
  const deep = withLuminance(darkest, Math.min(luminance(darkest), DEEP_MAX));
  const light = withLuminance(lightest, Math.max(luminance(lightest), LIGHT_MIN));

  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, members: [] as Rgb[] }));
  for (const colour of colours) {
    const chroma = Math.max(...colour) - Math.min(...colour);
    if (chroma < MIN_CHROMA) continue;
    const bin = bins[hueBin(colour)];
    bin.weight += chroma;
    bin.members.push(colour);
  }
  const ranked = bins.map((bin, index) => ({ ...bin, index })).sort((a, b) => b.weight - a.weight);
  if (ranked[0].weight === 0) {
    const middle = average(colours);
    return { deep, key: middle, cool: mix(middle, deep, 0.5), light };
  }
  const key = average(ranked[0].members);
  const second = ranked.find((bin) => bin.weight >= ranked[0].weight * MIN_COOL_SHARE && binGap(bin.index, ranked[0].index) >= 3);
  const cool = second ? average(second.members) : mix(key, deep, 0.5);
  return { deep, key, cool, light };
}
