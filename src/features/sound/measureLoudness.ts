import { CORE_BASE_URL } from "@/data/core/request";
import { isLocalId } from "@/engine/types";
import { loudnessGain } from "./lib/loudness";
import { useSoundStore } from "./store/soundStore";

const MAX_DURATION_MS = 20 * 60 * 1000;
const IDLE_TIMEOUT_MS = 10_000;
const DECODE_RATE = 44100;

type Decoder = (data: ArrayBuffer) => Promise<AudioBuffer>;

function decodeWithOfflineContext(data: ArrayBuffer): Promise<AudioBuffer> {
  return new OfflineAudioContext(2, 1, DECODE_RATE).decodeAudioData(data);
}

function analyseInWorker(channels: Float32Array[], sampleRate: number): Promise<number> {
  // shortcut: without Worker (unit tests) the estimate runs inline on this thread
  if (typeof Worker === "undefined") return Promise.resolve(loudnessGain(channels, sampleRate));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./loudness.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<number>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "loudness worker failed"));
    };
    // Channels may share one buffer, and a buffer can appear only once in the transfer list
    const buffers = [...new Set(channels.map((channel) => channel.buffer as ArrayBuffer))];
    try {
      worker.postMessage({ channels, sampleRate }, buffers);
    } catch (error) {
      worker.terminate();
      reject(error);
    }
  });
}

export async function measureLoudness(blob: Blob, decode: Decoder = decodeWithOfflineContext): Promise<number> {
  const buffer = await decode(await blob.arrayBuffer());
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return analyseInWorker(channels, buffer.sampleRate);
}

// One measurement at a time: each one holds a whole decoded track in memory
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job);
  queue = result.catch(() => undefined);
  return result;
}

function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(task, 0);
}

const pending = new Set<string>();

export function scheduleLoudness(trackId: string, audio: Blob | (() => Promise<Blob>), durationMs: number): void {
  if (durationMs > MAX_DURATION_MS) return;
  if (useSoundStore.getState().loudness[trackId] || pending.has(trackId)) return;
  pending.add(trackId);
  whenIdle(() => {
    enqueue(async () => measureLoudness(typeof audio === "function" ? await audio() : audio))
      .then((db) => useSoundStore.getState().setLoudness(trackId, db))
      .catch(() => undefined)
      .finally(() => pending.delete(trackId));
  });
}

export async function cachedAudio(trackId: string): Promise<Blob> {
  const id = encodeURIComponent(trackId);
  const path = isLocalId(trackId) ? `/v1/local/tracks/${id}/audio` : `/v1/cache/audio/${id}`;
  const response = await fetch(`${CORE_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`cached audio ${response.status}`);
  return response.blob();
}
