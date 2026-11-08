type Coefficients = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** ITU-R BS.1770 K-weighting: a +4 dB high shelf near 1.5 kHz, then a 38 Hz high-pass. */
function kWeighting(sampleRate: number): { shelf: Coefficients; highpass: Coefficients } {
  const shelfGain = 3.99984385397;
  const f0 = 1681.97445095;
  const q0 = 0.7071752369554193;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, shelfGain / 20);
  const Vb = Math.pow(Vh, 0.499666774155);
  let a0 = 1 + K / q0 + K * K;
  const shelf: Coefficients = [
    (Vh + (Vb * K) / q0 + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / q0 + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / q0 + K * K) / a0,
  ];
  const f1 = 38.13547087613982;
  const q1 = 0.5003270373253953;
  K = Math.tan((Math.PI * f1) / sampleRate);
  a0 = 1 + K / q1 + K * K;
  return { shelf, highpass: [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / q1 + K * K) / a0] };
}

const BUCKET_S = 0.1;
const BUCKETS_PER_BLOCK = 4;
const ABSOLUTE_GATE = -70;

/**
 * Integrated loudness (LUFS) of channels, gated per BS.1770-4, summing power across channels.
 * One pass per channel: both filters run inline and the weighted energy lands in 100 ms buckets,
 * so a 400 ms block (75% overlap) is the sum of four buckets and no filtered copy is allocated.
 * Returns -Infinity for silence.
 */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const step = Math.round(BUCKET_S * sampleRate);
  const bucketCount = Math.floor((channels[0]?.length ?? 0) / step);
  const buckets = new Float64Array(bucketCount);
  const { shelf, highpass } = kWeighting(sampleRate);
  const [s0, s1, s2, sa1, sa2] = shelf;
  const [h0, h1, h2, ha1, ha2] = highpass;
  for (const channel of channels) {
    // x: input history, y: shelf output history, z: high-pass output history
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0,
      z1 = 0,
      z2 = 0;
    let i = 0;
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      let energy = 0;
      for (const end = i + step; i < end; i++) {
        const x = channel[i];
        const y = s0 * x + s1 * x1 + s2 * x2 - sa1 * y1 - sa2 * y2;
        const z = h0 * y + h1 * y1 + h2 * y2 - ha1 * z1 - ha2 * z2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        z2 = z1;
        z1 = z;
        energy += z * z;
      }
      buckets[bucket] += energy;
    }
  }
  const block = step * BUCKETS_PER_BLOCK;
  const powers: number[] = [];
  for (let start = 0; start + BUCKETS_PER_BLOCK <= bucketCount; start++) {
    powers.push((buckets[start] + buckets[start + 1] + buckets[start + 2] + buckets[start + 3]) / block);
  }
  const lufs = (power: number) => -0.691 + 10 * Math.log10(power);
  const aboveAbsolute = powers.filter((p) => p > 0 && lufs(p) > ABSOLUTE_GATE);
  if (aboveAbsolute.length === 0) return -Infinity;
  const mean = (list: number[]) => list.reduce((s, p) => s + p, 0) / list.length;
  const relativeGate = lufs(mean(aboveAbsolute)) - 10;
  const gated = aboveAbsolute.filter((p) => lufs(p) > relativeGate);
  return lufs(mean(gated));
}

export const TARGET_LUFS = -14;
const MAX_GAIN_DB = 12;

/** Gain that brings a track to the target, clamped, and lowered so the peak stays under -1 dBFS. */
export function normalizationGain(loudness: number, peak: number): number {
  if (!Number.isFinite(loudness)) return 0;
  const wanted = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_LUFS - loudness));
  if (peak <= 0) return wanted;
  const headroom = -1 - 20 * Math.log10(peak);
  return Math.min(wanted, headroom);
}

export function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return peak;
}

/** Normalization gain in dB for decoded channels: loudness plus peak headroom. */
export function loudnessGain(channels: Float32Array[], sampleRate: number): number {
  return normalizationGain(integratedLoudness(channels, sampleRate), peakOf(channels));
}
