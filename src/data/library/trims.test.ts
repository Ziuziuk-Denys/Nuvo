import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTrim, loadTrims, saveTrim, trimSpan, useTrims } from "./trims";

const sent: Array<{ key: string; body?: unknown }> = [];

beforeEach(() => {
  sent.length = 0;
  useTrims.setState({ byTrack: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("nuvo-core://local", "")}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ key, body });
      if (key === "GET /v1/me/trims") return new Response(JSON.stringify({ items: [{ trackId: "a", startMs: 1000, endMs: 9000 }] }));
      if (key.startsWith("PUT")) return new Response(JSON.stringify({ trackId: "t1", startMs: body.startMs, endMs: body.endMs }));
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const song = { id: "t1", title: "Song", artists: "Band", coverUrl: "", durationMs: 200_000 };

describe("trims", () => {
  it("reads, saves with the song's snapshot and clears", async () => {
    await loadTrims();
    expect(useTrims.getState().byTrack.a).toEqual({ trackId: "a", startMs: 1000, endMs: 9000 });
    await saveTrim(song, 30_000, 150_000);
    expect(sent.at(-1)).toMatchObject({ key: "PUT /v1/tracks/t1/trim", body: { startMs: 30_000, endMs: 150_000, track: { id: "t1" } } });
    expect(useTrims.getState().byTrack.t1).toEqual({ trackId: "t1", startMs: 30_000, endMs: 150_000 });
    await clearTrim("t1");
    expect(sent.at(-1)?.key).toBe("DELETE /v1/tracks/t1/trim");
    expect(useTrims.getState().byTrack.t1).toBeUndefined();
  });
});

describe("trimSpan", () => {
  it("reads the current trim on every call", () => {
    expect(trimSpan("t1")).toBeNull();
    useTrims.setState({ byTrack: { t1: { trackId: "t1", startMs: 30_000, endMs: 150_000 } } });
    expect(trimSpan("t1")).toMatchObject({ startMs: 30_000, endMs: 150_000 });
  });
});
