import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { NuvoShell } from "@/shell/nuvoShell";
import {
  clearStorageCategories,
  deleteCachedAudio,
  formatStorageBytes,
  getAudioCacheLimitBytes,
  getCachedStorageAnalytics,
  hasCachedAudio,
  refreshStorageAnalytics,
  setAudioCacheLimitBytes,
} from "./storage";

const calls: string[] = [];
const shell = {
  chromiumUsage: vi.fn(async () => ({
    httpCacheBytes: 10,
    codeCacheBytes: 20,
    localStorageBytes: 999,
    indexedDbBytes: 999,
    serviceWorkerBytes: 30,
    blobBytes: 40,
    path: "/cache",
  })),
  clearChromiumCache: vi.fn(async () => {
    calls.push("web");
    return true;
  }),
  reveal: vi.fn(async () => true),
};

function daemon(routes: Record<string, (init?: RequestInit) => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("nuvo-core://local", "")}`;
      calls.push(key);
      const route = routes[key];
      if (!route) throw new TypeError("no route");
      return route(init);
    }),
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  calls.length = 0;
  window.nuvoShell = shell as unknown as NuvoShell;
});
afterEach(() => vi.unstubAllGlobals());

describe("storage analytics", () => {
  it("three categories from the daemon and Chromium, cached", async () => {
    daemon({ "GET /v1/cache/status": () => json({ usedBytes: 500, limitBytes: 2000, entries: 3, pinned: 0, covers: { bytes: 70, count: 2, limitBytes: 0 } }) });
    const analytics = await refreshStorageAnalytics();
    expect(analytics.categories.map(({ id, bytes }) => [id, bytes])).toEqual([
      ["audio", 500],
      ["covers", 70],
      ["web", 100],
    ]);
    expect(analytics.totalBytes).toBe(670);
    expect(getCachedStorageAnalytics()).toBe(analytics);
    expect(getAudioCacheLimitBytes()).toBe(2000);
    expect(analytics.categories.every((category) => category.labelKey.startsWith("ui.settings.storage_"))).toBe(true);
  });

  it("a failed daemon read counts as zero and does not fail the refresh", async () => {
    daemon({});
    const analytics = await refreshStorageAnalytics();
    expect(analytics.categories.map((category) => category.bytes)).toEqual([0, 0, 100]);
  });

  it("clears in order and stops at the first failure", async () => {
    daemon({ "DELETE /v1/cache/audio": () => new Response(null, { status: 204 }), "DELETE /v1/cache/covers": () => json({ code: "LOCKED" }, 423) });
    await expect(clearStorageCategories(["web", "covers", "audio"])).rejects.toMatchObject({ status: 423 });
    expect(calls).toEqual(["DELETE /v1/cache/audio", "DELETE /v1/cache/covers"]);
  });

  it("the limit goes to the daemon and the answer is kept", async () => {
    daemon({
      "PATCH /v1/cache/settings": (init) =>
        json({ usedBytes: 0, limitBytes: JSON.parse(String(init?.body)).limitBytes, entries: 0, pinned: 0, covers: { bytes: 0, count: 0, limitBytes: 0 } }),
    });
    await setAudioCacheLimitBytes(4096);
    expect(getAudioCacheLimitBytes()).toBe(4096);
  });

  it("byte formatting", () => {
    expect([0, 512, 1024, 1536, 12 * 1024 * 1024, 15.4 * 1024 ** 3].map(formatStorageBytes)).toEqual(["0 B", "512 B", "1 KB", "1.5 KB", "12 MB", "15 GB"]);
  });
});

describe("audio cache", () => {
  it("asks with a one-byte range and treats anything but 200 or 206 as not cached", async () => {
    daemon({ "GET /v1/cache/audio/abc": () => new Response("x", { status: 206 }), "GET /v1/cache/audio/zzz": () => new Response(null, { status: 404 }) });
    await expect(hasCachedAudio("abc")).resolves.toBe(true);
    await expect(hasCachedAudio("zzz")).resolves.toBe(false);
    await expect(hasCachedAudio("down")).resolves.toBe(false);
  });

  it("delete ignores a missing entry", async () => {
    daemon({ "DELETE /v1/cache/audio/abc": () => json({ code: "NOT_FOUND" }, 404) });
    await expect(deleteCachedAudio("abc")).resolves.toBeUndefined();
  });
});
