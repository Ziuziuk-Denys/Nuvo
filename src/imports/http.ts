export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

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
    open.set(response, { signal: controller.signal, release });
    return response;
  } catch (error) {
    release();
    if (http.signal.aborted) throw http.signal.reason;
    throw error instanceof HttpError ? error : new HttpError(0);
  }
}

export function drop(response: Response): void {
  void response.body?.cancel().catch(() => {});
  open.get(response)?.release();
}

const retryable = (error: unknown) => error instanceof HttpError && (error.status === 0 || error.status >= 500);

export async function get(url: string, http: Http): Promise<Response> {
  try {
    return await attempt(url, http);
  } catch (error) {
    if (!retryable(error)) throw error;
    await (http.sleep ?? sleep)(RETRY_DELAY_MS, http.signal);
    return attempt(url, http);
  }
}

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
