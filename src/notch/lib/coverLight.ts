const SAMPLE = 32;
const HUES = 24;
const LIGHTNESS = 0.73;
const MAX_CHROMA = 0.125;
const MIN_CHROMA = 0.06;
const COLOURLESS = 0.0003;
const COLOURFUL = 0.004;

/** Warm lamp white, for a cover without colour. */
export const NEUTRAL_LIGHT = "rgb(197 193 186)";

const toLinear = (byte: number) => (byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4);

function toScreen(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
}

function toLab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459939 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab(lightness: number, a: number, b: number): number[] {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function lightFromPixels(pixels: Uint8ClampedArray): string {
  const hues = Array.from({ length: HUES }, () => ({ weight: 0, a: 0, b: 0 }));
  const total = pixels.length / 4;
  for (let i = 0; i < total; i += 1) {
    const [l, a, b] = toLab(toLinear(pixels[i * 4]), toLinear(pixels[i * 4 + 1]), toLinear(pixels[i * 4 + 2]));
    const chroma = Math.hypot(a, b);
    if (chroma < 0.025 || l < 0.18) continue;
    const turn = (Math.atan2(b, a) / (2 * Math.PI) + 1) % 1;
    const weight = chroma * chroma * Math.sqrt(l);
    const hue = hues[Math.floor(turn * HUES) % HUES];
    hue.weight += weight;
    hue.a += a * weight;
    hue.b += b * weight;
  }
  const colour = hues.reduce((sum, hue) => sum + hue.weight, 0) / Math.max(1, total);
  const top = hues.reduce((best, hue) => (hue.weight > best.weight ? hue : best));
  if (colour < COLOURLESS || top.weight === 0) return NEUTRAL_LIGHT;
  const a = top.a / top.weight;
  const b = top.b / top.weight;
  const chroma = Math.hypot(a, b);
  const share = 0.35 + 0.65 * Math.min(1, colour / COLOURFUL);
  const wanted = Math.min(MAX_CHROMA, Math.max(MIN_CHROMA, chroma * 1.2)) * share;
  return `rgb(${fromLab(LIGHTNESS, (a / chroma) * wanted, (b / chroma) * wanted)
    .map(toScreen)
    .join(" ")})`;
}

export function coverLight(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return NEUTRAL_LIGHT;
  try {
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    return lightFromPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    // A cover served without CORS headers taints the canvas.
    return NEUTRAL_LIGHT;
  }
}
