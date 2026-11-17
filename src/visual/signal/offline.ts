import { WINDOW, createExtractor, type Features } from "./features";

const WARM_UP_MS = 2000;

export interface ChannelSource {
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export function downmix(buffer: ChannelSource): Float32Array {
  const first = buffer.getChannelData(0);
  const out = new Float32Array(first.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < out.length; i++) out[i] += data[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels;
  return out;
}

export function windowAt(pcm: Float32Array, sampleRate: number, timeMs: number, out: Float32Array): Float32Array {
  const centre = Math.round((timeMs / 1000) * sampleRate);
  const start = centre - out.length / 2;
  for (let j = 0; j < out.length; j++) {
    const at = start + j;
    out[j] = at >= 0 && at < pcm.length ? pcm[at] : 0;
  }
  return out;
}

export function analyse(pcm: Float32Array, sampleRate: number, fromMs: number, toMs: number, fps: number): Features[] {
  const extractor = createExtractor(sampleRate);
  const frameMs = 1000 / fps;
  const window = new Float32Array(WINDOW);

  const stepAt = (timeMs: number) => extractor.step(windowAt(pcm, sampleRate, timeMs, window), frameMs);

  const warmFrames = Math.floor(Math.min(WARM_UP_MS, fromMs) / frameMs);
  for (let k = warmFrames; k > 0; k--) stepAt(fromMs - k * frameMs);

  const count = Math.round(((toMs - fromMs) / 1000) * fps);
  const frames: Features[] = [];
  for (let i = 0; i < count; i++) frames.push(stepAt(fromMs + i * frameMs));
  return frames;
}
