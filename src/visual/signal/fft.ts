const FLOOR_DB = -80;

export interface Fft {
  magnitudes(window: Float32Array, out: Float32Array): void;
}

export function createFft(size: number): Fft {
  const bits = Math.log2(size);
  if (!Number.isInteger(bits)) throw new Error(`fft size ${size} is not a power of two`);
  const hann = new Float32Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }
  const cos = new Float32Array(size / 2);
  const sin = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  // a full-scale sine through a Hann window peaks at size / 4
  const scale = 4 / size;

  return {
    magnitudes(window, out) {
      for (let i = 0; i < size; i++) {
        re[reverse[i]] = window[i] * hann[i];
        im[reverse[i]] = 0;
      }
      for (let span = 2; span <= size; span *= 2) {
        const half = span / 2;
        const step = size / span;
        for (let start = 0; start < size; start += span) {
          for (let k = 0; k < half; k++) {
            const a = start + k;
            const b = a + half;
            const wr = cos[k * step];
            const wi = sin[k * step];
            const tr = re[b] * wr - im[b] * wi;
            const ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
      for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i], im[i]) * scale;
    },
  };
}

function toLevel(magnitude: number): number {
  if (magnitude <= 0) return 0;
  const db = 20 * Math.log10(magnitude);
  return Math.min(1, Math.max(0, 1 - db / FLOOR_DB));
}

export function logBands(magnitudes: Float32Array, sampleRate: number, out: Float32Array, minHz = 30, maxHz = 16_000): void {
  const binHz = sampleRate / (magnitudes.length * 2);
  const ratio = Math.pow(maxHz / minHz, 1 / out.length);
  for (let band = 0; band < out.length; band++) {
    const lowHz = minHz * Math.pow(ratio, band);
    const highHz = lowHz * ratio;
    const first = Math.ceil(lowHz / binHz);
    const last = Math.min(magnitudes.length - 1, Math.floor(highHz / binHz));
    let peak = 0;
    if (first <= last) {
      for (let bin = first; bin <= last; bin++) peak = Math.max(peak, magnitudes[bin]);
    } else {
      const position = Math.min(magnitudes.length - 1, Math.sqrt(lowHz * highHz) / binHz);
      const below = Math.floor(position);
      const above = Math.min(magnitudes.length - 1, below + 1);
      peak = magnitudes[below] + (magnitudes[above] - magnitudes[below]) * (position - below);
    }
    out[band] = toLevel(peak);
  }
}
