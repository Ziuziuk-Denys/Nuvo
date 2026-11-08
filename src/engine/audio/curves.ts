/** Gain curves for fades and transitions. Pure. */

export const FADE_MS = 180;
export const CURVE_POINTS = 64;

/** Raised cosine from `from` to `to`: smooth at both ends, so start and pause never click. */
export function raisedCosine(from: number, to: number, points = CURVE_POINTS): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    curve[i] = from + ((to - from) * (1 - Math.cos(Math.PI * t))) / 2;
  }
  return curve;
}

/** Equal-power pair for crossfades: out^2 + in^2 = 1 at every point. */
export function equalPower(points = CURVE_POINTS): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(points);
  const fadeOut = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const angle = (i / (points - 1)) * (Math.PI / 2);
    fadeIn[i] = Math.sin(angle);
    fadeOut[i] = Math.cos(angle);
  }
  return { fadeIn, fadeOut };
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
