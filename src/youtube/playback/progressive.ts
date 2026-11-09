export interface SourceBufferLike extends EventTarget {
  updating: boolean;
  appendBuffer(data: Uint8Array): void;
}

export interface MediaSourceLike extends EventTarget {
  readyState: string;
  duration: number;
  addSourceBuffer(mime: string): SourceBufferLike;
  endOfStream(reason?: "network" | "decode"): void;
}

export interface FeedPlatform {
  createMediaSource(): MediaSourceLike;
  createObjectURL(source: MediaSourceLike): string;
  revokeObjectURL(url: string): void;
}

export const QUOTA_RETRY_MS = 2000;
export const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export interface ProgressiveSource {
  url: string;
  whole: Promise<Blob>;
  overflowed(): boolean;
  release(): void;
}

export const browserFeed: FeedPlatform = {
  createMediaSource: () => new MediaSource() as unknown as MediaSourceLike,
  createObjectURL: (source) => URL.createObjectURL(source as unknown as MediaSource),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

export function progressiveSource(
  stream: ReadableStream<Uint8Array>,
  mime: string,
  durationMs: number | undefined,
  abortStream: () => void,
  platform: FeedPlatform = browserFeed,
): ProgressiveSource {
  const media = platform.createMediaSource();
  const url = platform.createObjectURL(media);
  const queue: Uint8Array[] = [];
  const chunks: Uint8Array[] = [];
  let buffer: SourceBufferLike | null = null;
  let streamDone = false;
  let ended = false;
  let disposed = false;
  let overflowed = false;
  let abandoned = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let settle!: {
    resolve: (blob: Blob) => void;
    reject: (error: unknown) => void;
  };
  const whole = new Promise<Blob>((resolve, reject) => (settle = { resolve, reject }));
  whole.catch(() => undefined);

  const finish = () => {
    if (ended || disposed || !streamDone || queue.length > 0 || buffer?.updating) return;
    ended = true;
    if (!abandoned && media.readyState === "open") media.endOfStream();
    settle.resolve(new Blob(chunks as BlobPart[], { type: mime }));
  };

  const pump = () => {
    if (disposed || !buffer || buffer.updating || retry || queue.length === 0) return finish();
    try {
      buffer.appendBuffer(queue[0]);
      queue.shift();
    } catch (error) {
      if ((error as { name?: string })?.name !== "QuotaExceededError") return fail(error);
      overflowed = true;
      retry = setTimeout(() => {
        retry = null;
        pump();
      }, QUOTA_RETRY_MS);
    }
  };

  const stopFeeding = () => {
    queue.length = 0;
    if (retry) clearTimeout(retry);
    retry = null;
    buffer?.removeEventListener("updateend", pump);
  };

  const fail = (error: unknown) => {
    if (ended || disposed) return;
    ended = true;
    stopFeeding();
    abortStream();
    if (media.readyState === "open") media.endOfStream("network");
    settle.reject(error);
  };

  const onSourceOpen = () => {
    if (disposed) return;
    buffer = media.addSourceBuffer(mime);
    if (durationMs && durationMs > 0) media.duration = durationMs / 1000;
    buffer.addEventListener("updateend", pump);
    pump();
  };
  media.addEventListener("sourceopen", onSourceOpen, { once: true });

  void (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || disposed || ended) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          if (!abandoned) {
            queue.push(value);
            if (overflowed && queue.reduce((sum, chunk) => sum + chunk.byteLength, 0) > MAX_QUEUED_BYTES) {
              abandoned = true;
              stopFeeding();
            }
          }
          pump();
        }
      }
      streamDone = true;
      pump();
    } catch (error) {
      fail(error);
    }
  })();

  return {
    url,
    whole,
    overflowed: () => overflowed,
    release: () => {
      if (disposed) return;
      disposed = true;
      stopFeeding();
      media.removeEventListener("sourceopen", onSourceOpen);
      abortStream();
      platform.revokeObjectURL(url);
      if (!ended) settle.reject(new DOMException("released", "AbortError"));
    },
  };
}
