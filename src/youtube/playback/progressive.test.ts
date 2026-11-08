import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { MAX_QUEUED_BYTES, progressiveSource, type FeedPlatform, type MediaSourceLike, type SourceBufferLike } from "./progressive";

class FakeBuffer extends EventTarget implements SourceBufferLike {
  updating = false;
  appended: number[] = [];
  appends = 0;
  failOn = new Set<number>();
  updateEndListeners = 0;
  constructor(private readonly quotaOn: Set<number>) {
    super();
  }
  addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (type === "updateend") this.updateEndListeners += 1;
    super.addEventListener(type, cb, options);
  }
  removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    if (type === "updateend") this.updateEndListeners -= 1;
    super.removeEventListener(type, cb, options);
  }
  appendBuffer(data: Uint8Array): void {
    this.appends += 1;
    if (this.quotaOn.has(this.appends)) throw new DOMException("full", "QuotaExceededError");
    if (this.failOn.has(this.appends)) throw new Error("bad data");
    this.updating = true;
    this.appended.push(data[0]);
    queueMicrotask(() => {
      this.updating = false;
      this.dispatchEvent(new Event("updateend"));
    });
  }
}

class FakeMediaSource extends EventTarget implements MediaSourceLike {
  readyState = "closed";
  duration = NaN;
  ends: Array<string | undefined> = [];
  buffer: FakeBuffer;
  constructor(quotaOn: number[] = []) {
    super();
    this.buffer = new FakeBuffer(new Set(quotaOn));
  }
  addSourceBuffer(): SourceBufferLike {
    return this.buffer;
  }
  endOfStream(reason?: "network" | "decode"): void {
    this.ends.push(reason);
    this.readyState = "ended";
  }
  sourceOpenListeners = 0;
  addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (type === "sourceopen") this.sourceOpenListeners += 1;
    super.addEventListener(type, cb, options);
  }
  removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    if (type === "sourceopen") this.sourceOpenListeners -= 1;
    super.removeEventListener(type, cb, options);
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("sourceopen"));
  }
}

function platform(media: FakeMediaSource) {
  const revoked: string[] = [];
  const feed: FeedPlatform = {
    createMediaSource: () => media,
    createObjectURL: () => "blob:feed",
    revokeObjectURL: (url) => revoked.push(url),
  };
  return { feed, revoked };
}

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
  });
  return {
    stream,
    push: (byte: number) => controller.enqueue(new Uint8Array([byte])),
    pushRaw: (data: Uint8Array) => controller.enqueue(data),
    close: () => controller.close(),
    error: (e: unknown) => controller.error(e),
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("progressive feed", () => {
  it("a quota error marks overflow and retries the same chunk after 2 s, in order", async () => {
    const media = new FakeMediaSource([3]);
    const { feed } = platform(media);
    const input = controlledStream();
    const source = progressiveSource(input.stream, "audio/webm", 200_000, () => undefined, feed);
    media.open();
    for (const byte of [1, 2, 3, 4, 5]) {
      input.push(byte);
      await flush();
    }
    expect(source.overflowed()).toBe(true);
    expect(media.buffer.appended).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(media.buffer.appended).toEqual([1, 2, 3, 4, 5]);
    expect(media.duration).toBe(200);
  });

  it("endOfStream once, after the queue drains", async () => {
    const media = new FakeMediaSource();
    const { feed } = platform(media);
    const input = controlledStream();
    const source = progressiveSource(input.stream, "audio/webm", undefined, () => undefined, feed);
    media.open();
    input.push(1);
    input.push(2);
    input.close();
    await flush();
    expect(media.ends).toEqual([undefined]);
    expect(new Uint8Array(await (await source.whole).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it("a stream error ends with network and rejects the whole file", async () => {
    const media = new FakeMediaSource();
    const { feed } = platform(media);
    const input = controlledStream();
    const source = progressiveSource(input.stream, "audio/webm", undefined, () => undefined, feed);
    media.open();
    input.error(new Error("broken"));
    await flush();
    expect(media.ends).toEqual(["network"]);
    await expect(source.whole).rejects.toThrow("broken");
  });

  it("release aborts the stream and revokes the URL", () => {
    const media = new FakeMediaSource();
    const { feed, revoked } = platform(media);
    const abort = vi.fn();
    const source = progressiveSource(controlledStream().stream, "audio/webm", undefined, abort, feed);
    source.release();
    expect(abort).toHaveBeenCalledOnce();
    expect(revoked).toEqual(["blob:feed"]);
  });

  it("a non-quota append error aborts the stream, ends with network and stops buffering", async () => {
    const media = new FakeMediaSource();
    media.buffer.failOn.add(2);
    const { feed } = platform(media);
    const input = controlledStream();
    const abort = vi.fn();
    const source = progressiveSource(input.stream, "audio/webm", undefined, abort, feed);
    media.open();
    for (const byte of [1, 2, 3]) {
      input.push(byte);
      await flush();
    }
    expect(abort).toHaveBeenCalledOnce();
    expect(media.ends).toEqual(["network"]);
    expect(media.buffer.appended).toEqual([1]);
    expect(media.buffer.updateEndListeners).toBe(0);
    await expect(source.whole).rejects.toThrow("bad data");
  });

  it("past the queue cap while overflowed the live feed is dropped but whole still completes", async () => {
    const media = new FakeMediaSource([1]);
    const { feed } = platform(media);
    const input = controlledStream();
    const source = progressiveSource(input.stream, "audio/webm", undefined, () => undefined, feed);
    media.open();
    const half = MAX_QUEUED_BYTES / 2 + 1;
    for (let i = 0; i < 3; i += 1) {
      input.pushRaw(new Uint8Array(half));
      await flush();
    }
    input.close();
    await flush();
    expect(source.overflowed()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(media.buffer.appended).toEqual([]);
    expect(media.ends).toEqual([]);
    expect((await source.whole).size).toBe(half * 3);
  });

  it("release during the retry timer cancels the retry", async () => {
    const media = new FakeMediaSource([1]);
    const { feed } = platform(media);
    const input = controlledStream();
    const source = progressiveSource(input.stream, "audio/webm", undefined, () => undefined, feed);
    media.open();
    input.push(1);
    await flush();
    source.release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(media.buffer.appends).toBe(1);
  });

  it("release removes the updateend listener and rejects whole with AbortError", async () => {
    const media = new FakeMediaSource();
    const { feed } = platform(media);
    const source = progressiveSource(controlledStream().stream, "audio/webm", undefined, () => undefined, feed);
    media.open();
    expect(media.buffer.updateEndListeners).toBe(1);
    source.release();
    expect(media.buffer.updateEndListeners).toBe(0);
    await expect(source.whole).rejects.toMatchObject({ name: "AbortError" });
  });

  it("release before sourceopen removes the sourceopen listener", () => {
    const media = new FakeMediaSource();
    const { feed } = platform(media);
    const source = progressiveSource(controlledStream().stream, "audio/webm", undefined, () => undefined, feed);
    expect(media.sourceOpenListeners).toBe(1);
    source.release();
    expect(media.sourceOpenListeners).toBe(0);
  });

  it("duration is left alone when durationMs is 0 or absent", () => {
    for (const duration of [0, undefined]) {
      const media = new FakeMediaSource();
      const { feed } = platform(media);
      progressiveSource(controlledStream().stream, "audio/webm", duration, () => undefined, feed);
      media.open();
      expect(media.duration).toBeNaN();
    }
  });

  it("empty chunks are skipped", async () => {
    const media = new FakeMediaSource();
    const { feed } = platform(media);
    const input = controlledStream();
    const source = progressiveSource(input.stream, "audio/webm", undefined, () => undefined, feed);
    media.open();
    input.pushRaw(new Uint8Array(0));
    input.push(1);
    input.close();
    await flush();
    expect(media.buffer.appends).toBe(1);
    expect((await source.whole).size).toBe(1);
  });
});
