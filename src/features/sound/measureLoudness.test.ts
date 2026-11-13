import { describe, expect, it, vi, afterEach } from "vitest";
import { loudnessGain } from "./lib/loudness";
import { cachedAudio, measureLoudness, scheduleLoudness } from "./measureLoudness";
import { useSoundStore } from "./store/soundStore";

const RATE = 44100;

// A sine of amplitude A on two identical channels measures about 20*log10(A) LUFS: 0.1 is -20 LUFS.
function fakeBuffer(amplitude: number): AudioBuffer {
  const data = new Float32Array(RATE * 5);
  for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  return { numberOfChannels: 2, sampleRate: RATE, getChannelData: () => data } as unknown as AudioBuffer;
}

const blob = new Blob([new Uint8Array(4)]);

afterEach(() => {
  vi.unstubAllGlobals();
  useSoundStore.setState({ loudness: {} });
});

describe("measureLoudness", () => {
  it("returns about +6 dB for a -20 LUFS sine", async () => {
    const gain = await measureLoudness(blob, async () => fakeBuffer(0.1));
    expect(Math.abs(gain - 6)).toBeLessThan(0.5);
  });

  it("lowers a loud track to the target", async () => {
    const gain = await measureLoudness(blob, async () => fakeBuffer(0.5));
    // About -6 LUFS wants -8 dB; the peak headroom (+5 dB) is not binding.
    expect(gain).toBeCloseTo(-7.9889, 3);
  });
});

describe("measureLoudness in a worker", () => {
  it("transfers each channel buffer once and terminates the worker", async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: { data: number }) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      transfer: ArrayBuffer[] = [];
      terminate = vi.fn();
      constructor(
        public url: URL,
        public options: WorkerOptions,
      ) {
        workers.push(this);
      }
      postMessage(data: { channels: Float32Array[]; sampleRate: number }, transfer: ArrayBuffer[]) {
        this.transfer = transfer;
        const gain = loudnessGain(data.channels, data.sampleRate);
        setTimeout(() => this.onmessage?.({ data: gain }), 0);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const buffer = fakeBuffer(0.1);
    const gain = await measureLoudness(blob, async () => buffer);
    expect(Math.abs(gain - 6)).toBeLessThan(0.5);
    expect(workers).toHaveLength(1);
    expect(workers[0].options).toEqual({ type: "module" });
    expect(String(workers[0].url)).toMatch(/loudness\.worker\.ts/);
    expect(workers[0].transfer).toEqual([buffer.getChannelData(0).buffer]);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects and terminates when the worker fails", async () => {
    const workers: Array<{ terminate: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      "Worker",
      class {
        onerror: ((event: { message: string }) => void) | null = null;
        terminate = vi.fn();
        constructor() {
          workers.push(this);
        }
        postMessage() {
          setTimeout(() => this.onerror?.({ message: "boom" }), 0);
        }
      },
    );
    await expect(measureLoudness(blob, async () => fakeBuffer(0.1))).rejects.toThrow("boom");
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleLoudness", () => {
  it("measures one track at a time", async () => {
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => cb());
    const releases: Array<() => void> = [];
    const decode = vi.fn(() => new Promise<AudioBuffer>((resolve) => releases.push(() => resolve(fakeBuffer(0.1)))));
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData = decode;
      },
    );
    scheduleLoudness("q1", blob, 1000);
    scheduleLoudness("q2", blob, 1000);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(decode).toHaveBeenCalledTimes(1);
    releases[0]();
    await vi.waitFor(() => expect(useSoundStore.getState().loudness.q1).toBeDefined());
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    expect(useSoundStore.getState().loudness.q2).toBeUndefined();
    releases[1]();
    await vi.waitFor(() => expect(useSoundStore.getState().loudness.q2).toBeDefined());
  });

  it("skips measured and over-long tracks", () => {
    const idle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    useSoundStore.setState({ loudness: { done: { db: 1, at: 1 } } });
    scheduleLoudness("done", blob, 1000);
    scheduleLoudness("long", blob, 25 * 60 * 1000);
    expect(idle).not.toHaveBeenCalled();
  });

  it("waits for the idle callback before decoding", async () => {
    let run: () => void = () => undefined;
    const idle = vi.fn((cb: () => void) => {
      run = cb;
    });
    const decode = vi.fn(async () => fakeBuffer(0.1));
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData = decode;
      },
    );
    scheduleLoudness("t1", blob, 1000);
    scheduleLoudness("t1", blob, 1000);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle.mock.calls[0]).toEqual([expect.any(Function), { timeout: 10_000 }]);
    expect(decode).not.toHaveBeenCalled();
    run();
    await vi.waitFor(() => expect(useSoundStore.getState().loudness.t1).toBeDefined());
    expect(decode).toHaveBeenCalledTimes(1);
    expect(useSoundStore.getState().loudness.t1.db).toBeGreaterThan(5);
  });

  it("releases the in-flight id when decoding fails", async () => {
    let run: () => void = () => undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((cb: () => void) => {
        run = cb;
      }),
    );
    const decode = vi.fn().mockRejectedValue(new Error("bad audio"));
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData = decode;
      },
    );
    scheduleLoudness("bad", blob, 1000);
    run();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const idle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    scheduleLoudness("bad", blob, 1000);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(useSoundStore.getState().loudness.bad).toBeUndefined();
  });
});

describe("cachedAudio", () => {
  it("reads streamed tracks from the cache and local tracks from their file", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("audio"));
    vi.stubGlobal("fetch", fetchMock);
    await cachedAudio("dQw4w9WgXcQ");
    await cachedAudio(`local:${"a".repeat(32)}`);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "nuvo-core://local/v1/cache/audio/dQw4w9WgXcQ",
      `nuvo-core://local/v1/local/tracks/local%3A${"a".repeat(32)}/audio`,
    ]);
  });

  it("fails while the track is not cached yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(cachedAudio("dQw4w9WgXcQ")).rejects.toThrow("404");
  });
});
