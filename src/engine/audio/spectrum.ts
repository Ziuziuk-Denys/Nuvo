/** Live EQ spectrum and clip light: an analyser that exists only while someone listens. */

export const SPECTRUM_BANDS = 48;
export const SPECTRUM_FFT = 2048;
export const SPECTRUM_SMOOTHING = 0.8;
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20_000;
export const CLIP_LEVEL = 0.99;
export const CLIP_HOLD_MS = 500;

export interface SpectrumFrame {
  bands: Float32Array;
  clip: boolean;
}
export type SpectrumListener = (frame: SpectrumFrame) => void;

/** Maps FFT bins to log-spaced bands; a band narrower than one bin takes the nearest bin. */
export function mapBands(bins: Uint8Array, sampleRate: number, out: Float32Array): void {
  const binHz = sampleRate / (bins.length * 2);
  const ratio = Math.pow(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ, 1 / out.length);
  out.fill(0);
  const filled = new Uint8Array(out.length);
  for (let bin = 1; bin < bins.length; bin++) {
    const band = Math.floor(Math.log((bin * binHz) / SPECTRUM_MIN_HZ) / Math.log(ratio));
    if (band < 0 || band >= out.length) continue;
    out[band] = Math.max(out[band], bins[bin] / 255);
    filled[band] = 1;
  }
  for (let band = 0; band < out.length; band++) {
    if (filled[band]) continue;
    const centerHz = SPECTRUM_MIN_HZ * Math.pow(ratio, band + 0.5);
    const bin = Math.min(bins.length - 1, Math.max(1, Math.round(centerHz / binHz)));
    out[band] = bins[bin] / 255;
  }
}

export interface SpectrumTap {
  subscribe(listener: SpectrumListener): () => void;
  dispose(): void;
}

/** The analyser is created on the first subscriber and disconnected with the last one. */
export function createSpectrumTap(context: AudioContext, source: AudioNode): SpectrumTap {
  const listeners = new Set<SpectrumListener>();
  let analyser: AnalyserNode | null = null;
  let frameId: number | null = null;
  let clipUntil = 0;
  let bins = new Uint8Array(0);
  let wave = new Float32Array(0);
  const bands = new Float32Array(SPECTRUM_BANDS);

  const hidden = () => typeof document !== "undefined" && document.hidden;

  function tick(): void {
    frameId = null;
    if (!analyser || hidden()) return;
    analyser.getByteFrequencyData(bins);
    analyser.getFloatTimeDomainData(wave);
    mapBands(bins, context.sampleRate, bands);
    const now = Date.now();
    for (let i = 0; i < wave.length; i++) {
      if (Math.abs(wave[i]) >= CLIP_LEVEL) {
        clipUntil = now + CLIP_HOLD_MS;
        break;
      }
    }
    const frame = { bands: bands.slice(), clip: now < clipUntil };
    for (const listener of [...listeners]) listener(frame);
    if (analyser) schedule();
  }

  function schedule(): void {
    if (frameId === null && analyser && !hidden()) frameId = requestAnimationFrame(tick);
  }

  function onVisibility(): void {
    schedule();
  }

  function start(): void {
    analyser = context.createAnalyser();
    analyser.fftSize = SPECTRUM_FFT;
    analyser.smoothingTimeConstant = SPECTRUM_SMOOTHING;
    bins = new Uint8Array(analyser.frequencyBinCount);
    wave = new Float32Array(analyser.fftSize);
    clipUntil = 0;
    source.connect(analyser);
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
  }

  function stop(): void {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    document.removeEventListener("visibilitychange", onVisibility);
    if (analyser) {
      source.disconnect(analyser);
      analyser.disconnect();
    }
    analyser = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!analyser) start();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    dispose() {
      listeners.clear();
      stop();
    },
  };
}
