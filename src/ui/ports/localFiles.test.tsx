// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useLocalRoots, useLocalTracks } from "./localFiles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const L = `local:${"a".repeat(32)}`;

const item = (n: number) => ({
  track: { id: `local:${n.toString(16).padStart(32, "0")}`, title: `Lantern ${n}`, artists: [{ id: "", name: "Band" }], durationMs: 1000 },
  codec: "flac",
  lossless: true,
  hasLyrics: false,
});

let host: HTMLDivElement;
let root: Root;
let last: { items: Array<{ track: { title: string } }>; loading: boolean; failed: boolean; reload(): void };
let roots: { failed: boolean };
const calls: Array<{ url: string; signal: AbortSignal | undefined }> = [];

function Probe({ query, limit }: { query: string; limit?: number }) {
  last = useLocalTracks(query, limit) as typeof last;
  roots = useLocalRoots();
  return null;
}
const render = (query: string, limit?: number) => act(async () => root.render(<Probe query={query} limit={limit} />));

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local file hooks", () => {
  it("the full list is asked once; typing filters it in memory with no request and no pause", async () => {
    const total = 20_000;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, signal: init?.signal ?? undefined });
        if (url.includes("/roots")) return Response.json({ items: [] });
        const start = Number(new URL(url).searchParams.get("cursor") ?? 0);
        const end = Math.min(start + 500, total);
        const items = Array.from({ length: end - start }, (_, i) => item(start + i));
        return Response.json({ items, nextCursor: end < total ? String(end) : null, total });
      }),
    );
    await render("");
    const asked = () => calls.filter((c) => c.url.includes("/tracks")).length;
    expect(asked()).toBe(total / 500);
    expect(last.items).toHaveLength(total);
    const started = performance.now();
    await render("lantern 19");
    const elapsed = performance.now() - started;
    expect(last.items.length).toBeGreaterThan(0);
    expect(last.items.every((i) => /^Lantern \d*19\d*$/.test(i.track.title))).toBe(true);
    expect(asked()).toBe(total / 500);
    // generous bound for slow CI; the filter itself takes a few milliseconds
    expect(elapsed).toBeLessThan(250);
    await render("");
    expect(last.items).toHaveLength(total);
  });

  it("a request still running when a limited search changes is aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, signal: init?.signal ?? undefined });
        if (url.includes("/roots")) return Response.json({ items: [] });
        return new Promise<Response>(() => undefined);
      }),
    );
    await render("x", 5);
    const first = calls.filter((c) => c.url.includes("/tracks")).at(-1)!;
    await render("xy", 5);
    expect(first.signal?.aborted).toBe(true);
  });

  it("a daemon error is reported as a failure, not as an empty library", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await render("");
    await act(async () => vi.advanceTimersByTime(200));
    expect(last.failed).toBe(true);
    expect(last.loading).toBe(false);
    expect(roots.failed).toBe(true);
  });
});
