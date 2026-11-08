/**
 * Streaming pitch shifter: phase-vocoder time stretch with identity phase locking, then resampling
 * back to the original duration.
 * Algorithm: J. Laroche and M. Dolson, "Improved phase vocoder time-scale modification of audio",
 * IEEE Transactions on Speech and Audio Processing 7(3), 1999. Stretch by a = 2^(semitones/12) with
 * analysis hop Ha and synthesis hop Hs = a * Ha, then read the stretched signal at rate a.
 * Each analysis hop consumes Ha input samples and yields Ha output samples, so it streams 1:1.
 *
 * All buffers are preallocated rings, so process() never allocates.
 */

export const PV_FRAME = 2048;
export const PV_HOP = 512;

const TWO_PI = 2 * Math.PI;

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
  reverse: Uint32Array;
}

const twiddleCache = new Map<number, Twiddles>();

function twiddlesFor(n: number): Twiddles {
  let table = twiddleCache.get(n);
  if (table) return table;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((TWO_PI * i) / n);
    sin[i] = Math.sin((TWO_PI * i) / n);
  }
  const reverse = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    reverse[i] = j;
  }
  table = { cos, sin, reverse };
  twiddleCache.set(n, table);
  return table;
}

/** In-place iterative radix-2 FFT with cached twiddles; `inverse` scales by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  const { cos, sin, reverse } = twiddlesFor(n);
  for (let i = 1; i < n; i++) {
    const j = reverse[i];
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const cr = cos[k * step];
        const ci = sign * sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function wrap(phase: number): number {
  return phase - TWO_PI * Math.round(phase / TWO_PI);
}

/** Positions are rebased by this multiple of every ring size before they lose precision. */
const REBASE = 1 << 24;

class Channel {
  /** Input ring; `inputStart` is the oldest unconsumed sample. */
  readonly input: Float32Array;
  inputStart = 0;
  inputCount = 0;
  /** Overlap-add ring addressed by absolute position, zeroed ahead of the write front. */
  readonly stretch: Float64Array;
  stretchWrite = 0;
  zeroedUpTo = 0;
  readPos = 0;
  /** Output FIFO ring. */
  readonly output: Float32Array;
  outputStart = 0;
  outputCount = 0;
  readonly prevPhase: Float64Array;
  readonly synthPhase: Float64Array;
  first = true;

  constructor(frame: number, stretchSize: number, outputSize: number) {
    this.input = new Float32Array(frame * 2);
    this.stretch = new Float64Array(stretchSize);
    this.output = new Float32Array(outputSize);
    this.prevPhase = new Float64Array(frame / 2 + 1);
    this.synthPhase = new Float64Array(frame / 2 + 1);
  }
}

function powerOfTwoAtLeast(value: number): number {
  let size = 1;
  while (size < value) size <<= 1;
  return size;
}

export class PhaseVocoderShifter {
  private ratio = 1;
  private readonly window: Float64Array;
  private readonly channels: Channel[] = [];
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly magnitude: Float64Array;
  private readonly phase: Float64Array;
  private readonly peaks: Int32Array;
  private readonly stretchMask: number;
  private readonly outputMask: number;
  private readonly inputMask: number;

  constructor(
    private readonly frame = PV_FRAME,
    private readonly hop = PV_HOP,
  ) {
    this.window = new Float64Array(frame);
    for (let i = 0; i < frame; i++) this.window[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / frame);
    this.re = new Float64Array(frame);
    this.im = new Float64Array(frame);
    this.magnitude = new Float64Array(frame / 2 + 1);
    this.phase = new Float64Array(frame / 2 + 1);
    this.peaks = new Int32Array(frame / 2 + 1);
    // The write front leads the read position by at most one frame plus a stretched hop (ratio up to 2).
    this.stretchMask = powerOfTwoAtLeast(frame * 4) - 1;
    this.outputMask = powerOfTwoAtLeast(frame * 4) - 1;
    this.inputMask = frame * 2 - 1;
    twiddlesFor(frame);
  }

  setSemitones(semitones: number): void {
    this.ratio = 2 ** (semitones / 12);
  }

  /** `input` and `output` hold one array per channel, all of the same length. */
  process(input: Float32Array[], output: Float32Array[]): void {
    while (this.channels.length < input.length) {
      this.channels.push(new Channel(this.frame, this.stretchMask + 1, this.outputMask + 1));
    }
    for (let c = 0; c < input.length; c++) {
      const channel = this.channels[c];
      const samples = input[c];
      for (let i = 0; i < samples.length; i++) {
        // An overfull ring would mean the caller never drains it; drop the oldest sample.
        if (channel.inputCount === channel.input.length) {
          channel.inputStart = (channel.inputStart + 1) & this.inputMask;
          channel.inputCount--;
        }
        channel.input[(channel.inputStart + channel.inputCount) & this.inputMask] = samples[i];
        channel.inputCount++;
      }
      while (channel.inputCount >= this.frame) this.analyse(channel);
      const out = output[c];
      for (let i = 0; i < out.length; i++) {
        if (channel.outputCount > 0) {
          out[i] = channel.output[channel.outputStart];
          channel.outputStart = (channel.outputStart + 1) & this.outputMask;
          channel.outputCount--;
        } else {
          out[i] = 0;
        }
      }
    }
  }

  private analyse(channel: Channel): void {
    const { frame, hop, re, im, magnitude, phase, window, peaks } = this;
    const bins = frame / 2 + 1;
    const synthHop = this.ratio * hop;
    for (let i = 0; i < frame; i++) {
      re[i] = channel.input[(channel.inputStart + i) & this.inputMask] * window[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      magnitude[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      phase[k] = Math.atan2(im[k], re[k]);
    }
    // Peaks: local maxima over two bins each side.
    let peakCount = 0;
    for (let k = 2; k < bins - 2; k++) {
      const m = magnitude[k];
      if (m > magnitude[k - 1] && m >= magnitude[k + 1] && m > magnitude[k - 2] && m >= magnitude[k + 2]) {
        peaks[peakCount++] = k;
      }
    }
    const synthPhase = channel.synthPhase;
    if (channel.first) {
      synthPhase.set(phase);
      channel.first = false;
    } else {
      for (let n = 0; n < peakCount; n++) {
        const p = peaks[n];
        const expected = (TWO_PI * p * hop) / frame;
        const deviation = wrap(phase[p] - channel.prevPhase[p] - expected);
        const trueFrequency = (TWO_PI * p) / frame + deviation / hop;
        synthPhase[p] = wrap(synthPhase[p] + trueFrequency * synthHop);
      }
      // Identity phase locking: every bin keeps its phase offset to the peak whose region it is in.
      let region = 0;
      for (let k = 0; k < bins && peakCount > 0; k++) {
        while (region < peakCount - 1 && Math.abs(peaks[region + 1] - k) < Math.abs(peaks[region] - k)) region++;
        const p = peaks[region];
        if (p === k) continue;
        synthPhase[k] = synthPhase[p] + (phase[k] - phase[p]);
      }
    }
    channel.prevPhase.set(phase);
    for (let k = 0; k < bins; k++) {
      re[k] = magnitude[k] * Math.cos(synthPhase[k]);
      im[k] = magnitude[k] * Math.sin(synthPhase[k]);
      if (k > 0 && k < bins - 1) {
        re[frame - k] = re[k];
        im[frame - k] = -im[k];
      }
    }
    fft(re, im, true);

    // Hann analysis and synthesis windows overlap-add to 1.5 * frame / (4 * hop); scale by the hop used.
    const gain = synthHop / (0.375 * frame);
    const stretch = channel.stretch;
    const mask = this.stretchMask;
    const at = Math.round(channel.stretchWrite);
    const end = at + frame;
    for (let p = channel.zeroedUpTo; p < end; p++) stretch[p & mask] = 0;
    if (end > channel.zeroedUpTo) channel.zeroedUpTo = end;
    for (let i = 0; i < frame; i++) stretch[(at + i) & mask] += re[i] * window[i] * gain;
    channel.stretchWrite += synthHop;
    channel.inputStart = (channel.inputStart + hop) & this.inputMask;
    channel.inputCount -= hop;

    // Samples before the next frame's start are final; read them at the stretch ratio.
    const final = Math.round(channel.stretchWrite);
    for (let produced = 0; produced < hop && channel.readPos + 1 < final; produced++) {
      const i = Math.floor(channel.readPos);
      const t = channel.readPos - i;
      const value = stretch[i & mask] * (1 - t) + stretch[(i + 1) & mask] * t;
      if (channel.outputCount < channel.output.length) {
        channel.output[(channel.outputStart + channel.outputCount) & this.outputMask] = value;
        channel.outputCount++;
      }
      channel.readPos += this.ratio;
    }

    // Keep absolute positions small; the shift is a multiple of every ring size.
    if (channel.readPos > REBASE) {
      channel.readPos -= REBASE;
      channel.stretchWrite -= REBASE;
      channel.zeroedUpTo -= REBASE;
    }
  }
}
