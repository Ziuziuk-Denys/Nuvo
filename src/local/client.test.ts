import { describe, expect, it, vi } from "vitest";
import { createLocalClient, downloadProgress, scanLine } from "./client";

const L = `local:${"a".repeat(32)}`;

function fake(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace("nuvo-core://local", "");
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { doFetch, calls };
}

describe("local client", () => {
  it("pages through every local track and maps snapshots", async () => {
    const item = (n: number) => ({
      track: { id: L, title: `T${n}`, artists: [{ id: "", name: "A" }], durationMs: 1000 },
      codec: "flac",
      bitrateKbps: 900,
      sampleRate: 44100,
      bitDepth: 24,
      lossless: true,
      hasLyrics: false,
    });
    const { doFetch, calls } = fake({
      "/v1/local/tracks?q=x&limit=500&cursor=500": { items: [item(2)], nextCursor: null, total: 2 },
      "/v1/local/tracks?q=x&limit=500": { items: [item(1)], nextCursor: "500", total: 2 },
    });
    const all = await createLocalClient("nuvo-core://local", doFetch).allTracks("x");
    expect(all.map((t) => t.track.title)).toEqual(["T1", "T2"]);
    expect(all[0]).toMatchObject({ unsupported: null, lossless: true, bitDepth: 24 });
    expect(calls).toHaveLength(2);
  });

  it("the scan line says the one thing that matters", () => {
    const ok = [{ id: 1, path: "/m", status: "ok" as const, files: 3, lastScanAt: 1 }];
    const base = {
      scanning: false,
      rootId: null,
      total: 0,
      read: 0,
      added: 0,
      updated: 0,
      removed: 0,
      unreadable: 0,
      skippedLinks: 0,
      truncated: false,
      watching: 1,
      polling: false,
      lastScanAt: 1,
    };
    expect(scanLine({ ...base, scanning: true, total: 20000, read: 1200 }, ok)).toEqual({ key: "ui.local.scan_reading", vars: { read: 1200, total: 20000 } });
    expect(scanLine(base, [{ ...ok[0], status: "missing" }])).toEqual({ key: "ui.local.scan_missing", vars: { path: "/m" } });
    const two = [
      { ...ok[0], status: "missing" as const },
      { ...ok[0], id: 2, path: "/n", status: "missing" as const },
    ];
    expect(scanLine(base, two)).toEqual({ key: "ui.local.scan_missing_many", vars: { count: 2 } });
    expect(scanLine({ ...base, truncated: true }, ok)).toEqual({ key: "ui.local.scan_truncated" });
    expect(scanLine({ ...base, polling: true }, ok)).toEqual({ key: "ui.local.scan_polling" });
    expect(scanLine(base, ok)).toEqual({ key: "ui.local.scan_watching", vars: { count: 1 } });
    expect(scanLine(base, [])).toBeNull();
  });

  it("progress sums running saves only", () => {
    const job = (status: string, done: number, failed: number, total: number) => ({
      id: status,
      label: "",
      dir: "",
      format: "original",
      status,
      total,
      done,
      failed,
      waiting: 0,
      createdAt: 0,
    });
    expect(downloadProgress([job("running", 3, 1, 10), job("done", 5, 0, 5), job("running", 0, 0, 2)])).toEqual({ done: 4, total: 12 });
    expect(downloadProgress([job("done", 5, 0, 5)])).toBeNull();
  });
});
