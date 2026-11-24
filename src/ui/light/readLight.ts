import { GRID } from "./shader";

export type Vec3 = readonly [number, number, number];

export interface CoverLight {
  key: Vec3;
  rim: Vec3;
  from: readonly [number, number];
  cells: readonly number[];
}

const HUES = 24;
const KEY_L = 0.73;
const RIM_L = 0.66;
const MAX_CHROMA = 0.125;
const MIN_CHROMA = 0.06;
const COLOURLESS = 0.0003;
const COLOURFUL = 0.004;
const LAMP_WHITE: Vec3 = [0.56, 0.535, 0.49];

const toLinear = (byte: number) => (byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4);

export function toScreen(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
}

function toLab(r: number, g: number, b: number): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459939 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab(lightness: number, a: number, b: number): Vec3 {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

interface Hue {
  weight: number;
  a: number;
  b: number;
}

function lampColour(hue: Hue, lightness: number, share: number): Vec3 {
  const a = hue.a / hue.weight;
  const b = hue.b / hue.weight;
  const chroma = Math.hypot(a, b);
  const wanted = Math.min(MAX_CHROMA, Math.max(MIN_CHROMA, chroma * 1.2)) * share;
  return fromLab(lightness, (a / chroma) * wanted, (b / chroma) * wanted);
}

const apart = (one: number, two: number) => Math.min(Math.abs(one - two), HUES - Math.abs(one - two));

export function readLight(pixels: Uint8ClampedArray): CoverLight {
  const side = Math.round(Math.sqrt(pixels.length / 4));
  const total = side * side;
  const hues: Hue[] = Array.from({ length: HUES }, () => ({ weight: 0, a: 0, b: 0 }));
  const lightness = new Float32Array(total);
  const cells = new Array<number>(GRID * GRID * 3).fill(0);
  const perCell = total / (GRID * GRID);
  let mean = 0;
  for (let i = 0; i < total; i += 1) {
    const rgb = [0, 1, 2].map((channel) => toLinear(pixels[i * 4 + channel]));
    const [l, a, b] = toLab(rgb[0], rgb[1], rgb[2]);
    lightness[i] = l;
    mean += l / total;
    const cell = Math.floor((Math.floor(i / side) / side) * GRID) * GRID + Math.floor(((i % side) / side) * GRID);
    rgb.forEach((value, channel) => {
      cells[cell * 3 + channel] += value / perCell;
    });
    const chroma = Math.hypot(a, b);
    if (chroma < 0.025 || l < 0.18) continue;
    const turn = (Math.atan2(b, a) / (2 * Math.PI) + 1) % 1;
    const weight = chroma * chroma * Math.sqrt(l);
    const hue = hues[Math.floor(turn * HUES) % HUES];
    hue.weight += weight;
    hue.a += a * weight;
    hue.b += b * weight;
  }

  let x = 0;
  let y = 0;
  let bright = 0;
  lightness.forEach((l, i) => {
    const weight = Math.max(0, l - mean) ** 1.5;
    x += weight * (((i % side) + 0.5) / side - 0.5);
    y += weight * ((Math.floor(i / side) + 0.5) / side - 0.5);
    bright += weight;
  });
  const lean = (sum: number) => (bright > 0 ? Math.max(-1, Math.min(1, (sum / bright) * 4)) : 0);
  const from = [lean(x), lean(y)] as const;

  const colour = hues.reduce((sum, hue) => sum + hue.weight, 0) / total;
  const top = hues.reduce((best, hue, i) => (hue.weight > hues[best].weight ? i : best), 0);
  if (colour < COLOURLESS || hues[top].weight === 0) return { key: LAMP_WHITE, rim: LAMP_WHITE, from, cells };
  const share = Math.min(1, colour / COLOURFUL);
  const second = hues.reduce((best, hue, i) => (apart(i, top) >= 4 && hue.weight > (best < 0 ? hues[top].weight * 0.1 : hues[best].weight) ? i : best), -1);
  return {
    key: lampColour(hues[top], KEY_L, 0.35 + 0.65 * share),
    rim: lampColour(hues[second < 0 ? top : second], RIM_L, second < 0 ? 0.5 : 1),
    from,
    cells,
  };
}

export const NEUTRAL: CoverLight = { key: LAMP_WHITE, rim: LAMP_WHITE, from: [0, -0.5], cells: new Array<number>(GRID * GRID * 3).fill(0.05) };

export const cssColour = (colour: Vec3): string => `rgb(${colour.map(toScreen).join(" ")})`;
