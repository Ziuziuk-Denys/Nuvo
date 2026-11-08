import { describe, expect, it, vi } from "vitest";
import { DownloadFetcher } from "./downloadFetcher";

const snap = (id: string) => ({ id, title: id, artists: [{ id: "", name: "A" }], durationMs: 1000 });

function fakeDaemon(queue: string[]) {
  const failed: string[] = [];
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/downloads/waiting?limit=1")) return new Response(JSON.stringify({ items: queue.length ? [snap(queue[0])] : [] }));
    const failedId = url.match(/items\/(.+)\/failed$/)?.[1];
    if (failedId && init?.method === "POST") {
      failed.push(decodeURIComponent(failedId));
      queue.shift();
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchFake, failed };
}

describe("DownloadFetcher", () => {
  it("caches each waiting track once, reports the ones it cannot fetch, then stops", async () => {
    const queue = ["aaaaaaaaaaa", "bbbbbbbbbbb"];
    const daemon = fakeDaemon(queue);
    const ensureCached = vi.fn(async (track: { id: string }) => {
      if (track.id === "aaaaaaaaaaa") {
        queue.shift(); // the daemon wrote the file and dropped it from the waiting list
        return true;
      }
      return false;
    });
    const fetcher = new DownloadFetcher({ base: "nuvo-core://local", fetch: daemon.fetch, ensureCached, log: () => undefined });
    fetcher.kick();
    fetcher.kick(); // a second kick while running joins the same loop
    await vi.waitFor(() => expect(queue).toEqual([]));
    expect(ensureCached.mock.calls.map(([t]) => t.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(daemon.failed).toEqual(["bbbbbbbbbbb"]);
  });

  it("an unreachable daemon ends the loop quietly; dispose stops new work", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof globalThis.fetch;
    const ensureCached = vi.fn();
    const fetcher = new DownloadFetcher({ base: "nuvo-core://local", fetch, ensureCached, log: () => undefined });
    fetcher.kick();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fetcher.dispose();
    fetcher.kick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ensureCached).not.toHaveBeenCalled();
  });

  it("a refused give-up ends the loop instead of spinning", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 500 });
      return new Response(JSON.stringify({ items: [snap("aaaaaaaaaaa")] }));
    }) as unknown as typeof globalThis.fetch;
    const ensureCached = vi.fn(async () => false);
    const fetcher = new DownloadFetcher({ base: "nuvo-core://local", fetch, ensureCached, log: () => undefined });
    fetcher.kick();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(ensureCached).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a track the daemon still lists after it was cached is given up once", async () => {
    const failed: string[] = [];
    let queue = ["aaaaaaaaaaa"];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        failed.push(url);
        queue = [];
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ items: queue.map(snap) }));
    }) as unknown as typeof globalThis.fetch;
    const ensureCached = vi.fn(async () => true);
    new DownloadFetcher({ base: "nuvo-core://local", fetch, ensureCached, log: () => undefined }).kick();
    await vi.waitFor(() => expect(failed).toHaveLength(1));
    expect(ensureCached).toHaveBeenCalledTimes(1);
  });
});
