/**
 * GET requests to the public sources (Apple Music pages, Deezer's API, short links): 15 s per
 * attempt and one retry after 1 s on a network error or a 5xx answer.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** A failed source request; `status` is 0 when no answer arrived. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export interface Http {
  fetch: FetchLike;
  signal: AbortSignal;
  sleep?: Sleep;
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;
export const RETRY_DELAY_MS = 1_000;

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** What a live body still needs: the attempt's abort signal and the cleanup of its timer. */
const open = new WeakMap<Response, { signal: AbortSignal; release(): void }>();

async function attempt(url: string, http: Http): Promise<Response> {
  http.signal.throwIfAborted();
  const controller = new AbortController();
  const stop = () => controller.abort(http.signal.reason);
  http.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => controller.abort(new HttpError(0)), http.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const release = () => {
    clearTimeout(timer);
    http.signal.removeEventListener("abort", stop);
  };
  try {
    const response = await http.fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      redirect: "follow",
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new HttpError(response.status);
    }
    // the timer and the cancel listener stay until the body is read or dropped
    open.set(response, { signal: controller.signal, release });
    return response;
  } catch (error) {
    release();
    if (http.signal.aborted) throw http.signal.reason;
    throw error instanceof HttpError ? error : new HttpError(0);
  }
}

/** Ends the attempt of a response whose body will not be read. */
export function drop(response: Response): void {
  void response.body?.cancel().catch(() => {});
  open.get(response)?.release();
}

const retryable = (error: unknown) => error instanceof HttpError && (error.status === 0 || error.status >= 500);

/** The answer of a GET, or `HttpError`; an abort rejects with the signal's reason. */
export async function get(url: string, http: Http): Promise<Response> {
  try {
    return await attempt(url, http);
  } catch (error) {
    if (!retryable(error)) throw error;
    await (http.sleep ?? sleep)(RETRY_DELAY_MS, http.signal);
    return attempt(url, http);
  }
}

/**
 * The body as text, or null when it is longer than `maxBytes`; a page is never read whole first.
 * A response from `get` is read under its attempt's timeout and the caller's cancel: a stalled
 * body rejects with `HttpError(0)` and a cancel with the abort reason.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    open.get(response)?.release();
    return "";
  }
  const guard = open.get(response);
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(guard?.signal.reason);
    if (guard?.signal.aborted) fail();
    else guard?.signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => {});
  const decoder = new TextDecoder();
  let size = 0;
  let out = "";
  try {
    for (;;) {
      const { done, value } = await (guard ? Promise.race([reader.read(), aborted]) : reader.read());
      if (done) return out + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      out += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof HttpError || guard?.signal.aborted ? guard?.signal.reason : new HttpError(0);
  } finally {
    guard?.release();
  }
}
