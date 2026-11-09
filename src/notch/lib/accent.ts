const MIN_ALPHA = 128;
const MIN_BRIGHTNESS = 48;
const MIN_SATURATION = 0.2;
// The accent sits on pure black: lifted until it has 3:1 contrast there (WCAG non-text minimum).
const MIN_LUMINANCE = 0.1;
const LIFT_STEPS = 20;

function relativeLuminance([r, g, b]: number[]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function liftToContrast(color: number[]): number[] {
  const peak = Math.max(...color);
  const full = color.map((v) => (v / peak) * 255);
  for (let i = 0; i <= LIFT_STEPS * 2; i++) {
    const t = i / LIFT_STEPS;
    const candidate = (t <= 1 ? color.map((v, k) => v + (full[k] - v) * t) : full.map((v) => v + (255 - v) * (t - 1))).map((v) => Math.min(255, Math.round(v)));
    if (relativeLuminance(candidate) >= MIN_LUMINANCE) return candidate;
  }
  return [255, 255, 255];
}

export function accentFromPixels(data: Uint8ClampedArray): string {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (data[i + 3] < MIN_ALPHA || max < MIN_BRIGHTNESS) continue;
    if ((max - min) / max < MIN_SATURATION) continue;
    red += r;
    green += g;
    blue += b;
    count++;
  }
  if (count === 0) return "#ffffff";
  const color = liftToContrast([red / count, green / count, blue / count]);
  return `#${color.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
