const HUES = 12;
const MIN_PEAK = 150;
const MIN_CHROMA = 0.012;

interface Bin {
  weight: number;
  sum: [number, number, number];
}

const bin = (): Bin => ({ weight: 0, sum: [0, 0, 0] });

function add(into: Bin, data: Uint8ClampedArray, at: number, weight: number): void {
  into.weight += weight;
  for (let k = 0; k < 3; k++) into.sum[k] += data[at + k] * weight;
}

function hueOf(r: number, g: number, b: number, max: number, chroma: number): number {
  const turn = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return Math.floor((turn / 6) * HUES) % HUES;
}

export function lampColor(data: Uint8ClampedArray): string {
  const hues = Array.from({ length: HUES }, bin);
  const grey = bin();
  let pixels = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);
    pixels += 1;
    add(grey, data, i, 0.05 + max / 255);
    if (chroma > 0) add(hues[hueOf(r, g, b, max, chroma)], data, i, (chroma / 255) ** 2 * (max / 255));
  }
  const best = hues.reduce((a, b) => (b.weight > a.weight ? b : a));
  const from = best.weight / Math.max(1, pixels) >= MIN_CHROMA ? best : grey;
  if (from.weight === 0) return "#ffffff";
  const color = from.sum.map((value) => value / from.weight);
  const peak = Math.max(1, ...color);
  const lift = peak < MIN_PEAK ? MIN_PEAK / peak : 1;
  return `#${color
    .map((value) =>
      Math.round(Math.min(255, value * lift))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
