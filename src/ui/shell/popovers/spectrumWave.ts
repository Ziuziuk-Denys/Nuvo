export interface Follow {
  attack: number;
  release: number;
}

export const FRONT_WAVE: Follow = { attack: 0.5, release: 0.12 };
export const BACK_WAVE: Follow = { attack: 0.1, release: 0.03 };
export const CALM_WAVE: Follow = { attack: 0.03, release: 0.015 };

// shapes music the way the ear hears it, so the highs do not sit flat on the floor
const TILT_DB_PER_OCTAVE = 3;
// the analyser maps -100..-30 dB onto 0..1
const ANALYSER_SPAN_DB = 70;
const SPAN_OCTAVES = Math.log2(20000 / 20);
const SETTLED = 0.002;
const EDGE = 12;

export function shapeBands(bands: Float32Array, out: Float32Array): void {
  const count = bands.length;
  for (let index = 0; index < count; index++) {
    const left = bands[Math.max(0, index - 1)];
    const right = bands[Math.min(count - 1, index + 1)];
    const level = (left + bands[index] * 2 + right) / 4;
    const octavesFrom1k = ((index + 0.5) / count) * SPAN_OCTAVES - Math.log2(1000 / 20);
    const tilted = level > 0 ? level + (octavesFrom1k * TILT_DB_PER_OCTAVE) / ANALYSER_SPAN_DB : 0;
    out[index] = Math.min(1, Math.max(0, tilted));
  }
}

export function follow(levels: Float32Array, target: Float32Array | null, speed: Follow): boolean {
  let settled = true;
  for (let index = 0; index < levels.length; index++) {
    const goal = target ? target[index] : 0;
    const rate = goal > levels[index] ? speed.attack : speed.release;
    levels[index] += (goal - levels[index]) * rate;
    if (levels[index] > SETTLED) settled = false;
  }
  return settled;
}

// a monotone cubic through the band centres: smooth, and never overshoots above a peak or below the floor
export function wavePath(levels: Float32Array, width: number, floor: number, span: number): string {
  const count = levels.length;
  const xs = [0, ...Array.from(levels, (_, index) => ((index + 0.5) / count) * width), width];
  const ys = [levels[0], ...levels, levels[count - 1]].map((level) => floor - level * span);
  const slopes = xs.slice(1).map((x, index) => (ys[index + 1] - ys[index]) / (x - xs[index]));
  const tangents = xs.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === xs.length - 1) return slopes[index - 1];
    const before = slopes[index - 1];
    const after = slopes[index];
    const h0 = xs[index] - xs[index - 1];
    const h1 = xs[index + 1] - xs[index];
    const mean = (before * h1 + after * h0) / (h0 + h1);
    return (Math.sign(before) + Math.sign(after)) * Math.min(Math.abs(before), Math.abs(after), Math.abs(mean) / 2);
  });
  const at = (value: number) => value.toFixed(1);
  // the closing edges run outside the view box, so a stroke shows only along the crest
  let path = `M${-EDGE},${at(floor + EDGE)}L${-EDGE},${at(ys[0])}L0,${at(ys[0])}`;
  for (let index = 0; index < xs.length - 1; index++) {
    const third = (xs[index + 1] - xs[index]) / 3;
    path += `C${at(xs[index] + third)},${at(ys[index] + tangents[index] * third)},${at(xs[index + 1] - third)},${at(ys[index + 1] - tangents[index + 1] * third)},${at(xs[index + 1])},${at(ys[index + 1])}`;
  }
  return `${path}L${at(width + EDGE)},${at(ys[ys.length - 1])}L${at(width + EDGE)},${at(floor + EDGE)}Z`;
}
