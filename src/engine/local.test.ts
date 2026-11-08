import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { createHarness, flush, track, y, type Harness } from "./test/harness";
import { idKind, primarySource } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const L = `local:${"a".repeat(32)}`;
const AUDIO = `/v1/local/tracks/${encodeURIComponent(L)}/audio`;

function playable(h: Harness) {
  h.daemon.on(
    `GET ${AUDIO}`,
    () =>
      new Response(new Uint8Array([1]), {
        status: 206,
        headers: { "content-range": "bytes 0-0/1000", "x-nuvo-codec": "flac", "x-nuvo-bitrate": "900", "content-type": "audio/flac" },
      }),
  );
}

describe("local files", () => {
  it("ids", () => {
    expect(idKind(L)).toBe("local");
    expect(idKind("local:xyz")).toBe("other");
    expect(primarySource(L)).toBe("local");
    expect(primarySource("sc:1")).toBe("soundcloud");
    expect(primarySource(y("t"))).toBe("youtube");
  });

  it("a local file plays from the daemon and is never cached", async () => {
    const h = createHarness();
    playable(h);
    h.engine.playList([track(L), track(y("n"))]);
    await flush();
    expect(h.deck.loads[0].source.url).toBe(`nuvo-core://local${AUDIO}`);
    expect(h.youtube.resolves).toEqual([]);
    expect(h.engine.getView().stream).toMatchObject({ source: "local", codec: "flac", bitrateKbps: 900, fromCache: false });
    expect(h.daemon.callsTo("PUT", "/v1/cache/audio")).toEqual([]);
    expect(h.daemon.callsTo("POST", "/v1/cache/fetch")).toEqual([]);
    expect(h.daemon.callsTo("GET", `/v1/cache/audio/${encodeURIComponent(L)}`)).toEqual([]);
  });

  it("a missing file plays its YouTube match and says why", async () => {
    const h = createHarness();
    h.daemon.on(`GET ${AUDIO}`, () => new Response(null, { status: 404 }));
    h.match.answers = [{ track: track(y("m")), score: 92 }];
    h.engine.playList([track(L)]);
    await flush();
    expect(h.match.calls[0]).toMatchObject({ target: "youtube", id: L });
    expect(h.youtube.resolves).toEqual([y("m")]);
    expect(h.engine.getView().fallback).toMatchObject({ primarySource: "local", usedSource: "youtube", cause: "unavailable" });
  });

  it("an unsupported file (ALAC) falls back too, and a missing match skips with a reason", async () => {
    const h = createHarness();
    h.daemon.on(`GET ${AUDIO}`, () => new Response(null, { status: 415 }));
    h.engine.playList([track(L), track(y("n"))]);
    await flush();
    expect(h.match.calls.length).toBeGreaterThan(0);
    expect(h.engine.getView().notice).toMatchObject({ kind: "skipped" });
  });
});
