/** Whole-file download for the cache when the daemon cannot fetch the URL itself. */
import type { FetchLike } from "../http";
import { YtError, abortError, isAbortError } from "../types";

export const CHUNK_BYTES = 1 << 20;
export const MAX_IN_FLIGHT = 4;
export const CHUNK_ATTEMPTS = 2;
const MAX_FILE_SIZE = 200 * 1024 * 1024;

const isGooglevideo = (url: string) => {
  try {
    return new URL(url).hostname.endsWith(".googlevideo.com");
  } catch {
    return false;
  }
};

/** The whole file, or `null` when it is not cacheable (partial, empty or refused). Chunk failures reject. */
export async function downloadWhole(
  fetchFn: FetchLike,
  url: string,
  contentLength: number | undefined,
  mimeType: string,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (signal.aborted) throw abortError();
  if (contentLength && contentLength > 0 && isGooglevideo(url)) {
    if (contentLength > MAX_FILE_SIZE)
      throw new YtError("rejected-stream", {
        text: `file too large: ${contentLength}`,
      });
    return chunked(fetchFn, url, contentLength, mimeType, signal);
  }
  let response: Response;
  try {
    response = await fetchFn(url, { signal });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throw abortError();
    return null;
  }
  await Promise.resolve();
  if (signal.aborted) throw abortError();
  if (!response.ok && response.status !== 206) return null;
  let arrayBuffer: ArrayBuffer;
  let abortThrown = false;
  const abortHandler = () => {
    abortThrown = true;
  };
  signal.addEventListener("abort", abortHandler, { once: true });
  try {
    arrayBuffer = await response.arrayBuffer();
    if (abortThrown || signal.aborted) throw abortError();
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throw abortError();
    throw error;
  } finally {
    signal.removeEventListener("abort", abortHandler);
  }
  const bytes = new Uint8Array(arrayBuffer);
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const expected = Number(contentLengthHeader);
    if (expected !== bytes.byteLength)
      throw new YtError("rejected-stream", {
        text: `content-length ${expected} != received ${bytes.byteLength}`,
      });
  }
  const total = Number(response.headers.get("content-range")?.split("/")[1]);
  if (Number.isFinite(total) && total > bytes.byteLength) return null;
  await Promise.resolve();
  if (signal.aborted) throw abortError();
  return arrayBuffer.byteLength > 0 ? new Blob([new Uint8Array(arrayBuffer)], { type: mimeType }) : null;
}

async function chunked(fetchFn: FetchLike, url: string, length: number, mimeType: string, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw abortError();
  const buffer = new Uint8Array(length);
  const count = Math.ceil(length / CHUNK_BYTES);
  const inner = new AbortController();
  const stop = () => inner.abort();
  signal.addEventListener("abort", stop, { once: true });
  let next = 0;

  const fetchChunk = async (index: number) => {
    const start = index * CHUNK_BYTES;
    const end = Math.min(start + CHUNK_BYTES, length) - 1;
    const target = new URL(url);
    target.searchParams.set("range", `${start}-${end}`);
    let lastError: unknown;
    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
      if (inner.signal.aborted) throw abortError();
      try {
        const response = await fetchFn(target.toString(), {
          signal: inner.signal,
        });
        if (!response.ok) throw new YtError("http", { status: response.status });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== end - start + 1)
          throw new YtError("rejected-stream", {
            text: `short chunk ${bytes.byteLength}`,
          });
        buffer.set(bytes, start);
        return;
      } catch (error) {
        if (isAbortError(error) || inner.signal.aborted) throw abortError();
        const isYtError = error instanceof YtError;
        const is4xxNonRetryable =
          isYtError &&
          error.code === "http" &&
          typeof error.status === "number" &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429;
        if (is4xxNonRetryable) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };

  const lane = async () => {
    while (next < count) {
      const index = next;
      next += 1;
      await fetchChunk(index);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, count) }, lane));
  } catch (error) {
    inner.abort();
    if (signal.aborted) throw abortError();
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
  }
  return new Blob([buffer], { type: mimeType });
}
