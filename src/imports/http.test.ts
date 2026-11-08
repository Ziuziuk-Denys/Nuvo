import { describe, expect, it, vi, afterEach } from "vitest";
import { HttpError, get, readCapped, type FetchLike } from "./http";

const ok = (body = "{}") => new Response(body, { status: 200 });

afterEach(() => {
  vi.useRealTimers();
});

describe("get", () => {
  it("retries once after 1 s on a 5xx answer", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(ok("done"));
    const sleep = vi.fn(async () => {});
    const response = await get("https://api.deezer.com/playlist/1", {
      fetch,
      sleep,
      signal: new AbortController().signal,
    });
    expect(await response.text()).toBe("done");
    expect(sleep).toHaveBeenCalledWith(1_000, expect.anything());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a network error once, then gives up with status 0", async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await get("https://api.deezer.com/x", {
      fetch,
      sleep: async () => {},
      signal: new AbortController().signal,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response("", { status: 404 }));
    const error = await get("https://music.apple.com/gb/playlist/pl.a", {
      fetch,
      sleep: async () => {},
      signal: new AbortController().signal,
    }).catch((e) => e);
    expect(error.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("times an attempt out after 15 s", async () => {
    vi.useFakeTimers();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const pending = get("https://api.deezer.com/x", {
      fetch,
      sleep: async () => {},
      signal: new AbortController().signal,
    }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await pending;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(0);
  });

  it("rejects with the abort reason and does not retry after cancel", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<FetchLike>(
      (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const pending = get("https://api.deezer.com/x", {
      fetch,
      signal: controller.signal,
    }).catch((e) => e);
    controller.abort(new DOMException("cancelled", "AbortError"));
    const error = await pending;
    expect((error as DOMException).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends no cookies", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(ok());
    await get("https://api.deezer.com/x", {
      fetch,
      signal: new AbortController().signal,
    });
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });
});

/** A body that delivers `first`, then never answers; `cancelled` records the cancel. */
function stalledBody(first = "{") {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(first));
    },
    cancel: cancelled,
  });
  return { body, cancelled };
}

describe("reading a body", () => {
  it("times a stalled body out with the attempt's 15 s", async () => {
    vi.useFakeTimers();
    const { body, cancelled } = stalledBody();
    const fetch: FetchLike = async () => new Response(body, { status: 200 });
    const response = await get("https://api.deezer.com/x", {
      fetch,
      signal: new AbortController().signal,
    });
    const pending = readCapped(response, 1_000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await pending;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(0);
    expect(cancelled).toHaveBeenCalled();
  });

  it("cancels mid-read with the abort reason", async () => {
    const controller = new AbortController();
    const { body, cancelled } = stalledBody();
    const response = await get("https://api.deezer.com/x", {
      fetch: async () => new Response(body, { status: 200 }),
      signal: controller.signal,
    });
    const pending = readCapped(response, 1_000).catch((e) => e);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException("cancelled", "AbortError"));
    expect(((await pending) as DOMException).name).toBe("AbortError");
    expect(cancelled).toHaveBeenCalled();
  });

  it("returns null and cancels the stream when the body passes the cap", async () => {
    const { body, cancelled } = stalledBody("x".repeat(20));
    expect(await readCapped(new Response(body), 10)).toBeNull();
    expect(cancelled).toHaveBeenCalled();
  });

  it("reads a body under the cap whole, Cyrillic included", async () => {
    expect(await readCapped(new Response("Песни: Тёмный лес"), 100)).toBe("Песни: Тёмный лес");
  });

  it("cancels the body of a refused answer", async () => {
    const { body, cancelled } = stalledBody();
    const error = await get("https://api.deezer.com/x", {
      fetch: async () => new Response(body, { status: 404 }),
      signal: new AbortController().signal,
    }).catch((e) => e);
    expect(error.status).toBe(404);
    expect(cancelled).toHaveBeenCalled();
  });
});
