import { loudnessGain } from "./lib/loudness";

// Off the main thread: a 20 minute track takes about half a second to weigh
self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  const { channels, sampleRate } = event.data;
  self.postMessage(loudnessGain(channels, sampleRate));
};
