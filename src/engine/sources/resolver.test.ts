import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { FallbackBudget } from "./fallbackPlan";
import {
  SourceFailure,
  youtubeCause,
  type Alternative,
  type CacheProbe,
  type DaemonPort,
  type MatchPort,
  type PlayableSource,
  type YoutubePort,
} from "./ports";
import { SourceResolver, type ResolveOptions } from "./resolver";
import type { Track } from "../types";

const yid = (letter: string) => letter.repeat(11);
const track = (id: string, durationMs = 200_000): Track => ({ id, title: id, artists: "A", coverUrl: "", durationMs });
const playable = (bitrate: number, codec = "opus"): PlayableSource => ({ url: "https://yt/x", mimeType: "audio/webm", codec, bitrate });

interface Fakes {
  probe: (signal?: AbortSignal) => Promise<CacheProbe | null>;
  alternative: Alternative | null;
  yt: (target: Track, signal: AbortSignal) => Promise<PlayableSource>;
  match: (target: string, exclude?: ReadonlySet<string>) => Promise<{ track: Track; score: number } | null>;
  sc: (id: string) => Promise<unknown>;
}

function setup(over: Partial<Fakes> = {}) {
  const fakes: Fakes = {
    probe: async () => null,
    alternative: null,
    yt: async () => playable(128_000),
    match: async () => null,
    sc: async () => ({ kind: "direct", url: "https://sc/x", expiresAt: null, codec: "aac", mimeType: "audio/mp4", bitrate: 160_000, contentLength: null }),
    ...over,
  };
  const probeCache = vi.fn((_id: string, signal?: AbortSignal) => fakes.probe(signal));
  const putAlternative = vi.fn(async () => undefined);
  const daemon = {
    probeCache,
    cacheUrl: (id: string) => `cache/${id}`,
    getAlternative: vi.fn(async () => fakes.alternative),
    putAlternative,
    rejectAlternative: vi.fn(async () => undefined),
    scStream: vi.fn(async (id: string) => fakes.sc(id)),
    deleteCache: vi.fn(async () => undefined),
  } as unknown as DaemonPort;
  const ytResolve = vi.fn(async (target: Track, _o: unknown, signal: AbortSignal) => fakes.yt(target, signal));
  const youtube = { resolve: ytResolve, fetchWhole: vi.fn(), warmUp: vi.fn() } as unknown as YoutubePort;
  const approvedOn = vi.fn(async (target: "youtube" | "soundcloud", _t: Track, _s: AbortSignal, exclude?: ReadonlySet<string>) => fakes.match(target, exclude));
  const match: MatchPort = { approvedOn };
  const resolver = new SourceResolver({
    daemon,
    youtube,
    match,
    now: () => Date.now(),
    online: () => true,
    offerSignIn: () => false,
    objectUrls: { create: () => "blob:x", revoke: () => undefined },
  });
  return { resolver, daemon, probeCache, putAlternative, ytResolve, approvedOn, fakes };
}

const opts = (over: Partial<ResolveOptions> = {}): ResolveOptions => ({
  positionMs: 0,
  bypassCache: false,
  bestQuality: false,
  signal: new AbortController().signal,
  ...over,
});
const unavailable = () => Promise.reject({ code: "http", status: 404 });
const scMatch = (id: string, durationMs = 200_000) => ({ track: track(id, durationMs), score: 90 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("cache probe and head start", () => {
  it("a cached track plays from the cache with no resolve", async () => {
    const s = setup({ probe: async () => ({ codec: "opus", bitrateKbps: 128 }) });
    const resolved = await s.resolver.resolve(track(yid("a")), opts());
    expect(resolved.source.kind).toBe("cache");
    expect(s.ytResolve).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a probe that stays silent starts the network resolve after 150 ms", async () => {
    const s = setup({ probe: () => new Promise(() => undefined) });
    const pending = s.resolver.resolve(track(yid("a")), opts());
    await vi.advanceTimersByTimeAsync(149);
    expect(s.ytResolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(s.ytResolve).toHaveBeenCalledTimes(1);
    expect((await pending).source.kind).toBe("url");
  });

  it("a probe hit after the head start wins and aborts the network resolve", async () => {
    let netSignal: AbortSignal | undefined;
    const s = setup({
      probe: () => new Promise((resolve) => setTimeout(() => resolve({ codec: "opus", bitrateKbps: 128 }), 400)),
      yt: (_t, signal) => {
        netSignal = signal;
        return new Promise(() => undefined);
      },
    });
    const pending = s.resolver.resolve(track(yid("a")), opts());
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).source.kind).toBe("cache");
    expect(netSignal?.aborted).toBe(true);
  });

  it("a miss goes to the network", async () => {
    const s = setup();
    expect((await s.resolver.resolve(track(yid("a")), opts())).source.kind).toBe("url");
  });

  it("no timer is left behind when the probe wins, and an abort during the head start rejects", async () => {
    const hit = setup({ probe: () => new Promise((resolve) => setTimeout(() => resolve({ codec: null, bitrateKbps: null }), 50)) });
    const pending = hit.resolver.resolve(track(yid("a")), opts());
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    expect(vi.getTimerCount()).toBe(0);

    const silent = setup({ probe: () => new Promise(() => undefined) });
    const controller = new AbortController();
    const aborted = silent.resolver.resolve(track(yid("a")), opts({ signal: controller.signal }));
    const caught = aborted.catch((error: unknown) => error);
    controller.abort();
    expect(((await caught) as Error).name).toBe("AbortError");
    expect(silent.ytResolve).not.toHaveBeenCalled();
  });

  it("best quality with a probe hit during the parallel resolve reuses that resolve", async () => {
    const s = setup({
      probe: () => new Promise((resolve) => setTimeout(() => resolve({ codec: "opus", bitrateKbps: 64 }), 300)),
      yt: () => new Promise((resolve) => setTimeout(() => resolve(playable(160_000)), 500)),
    });
    const pending = s.resolver.resolve(track(yid("a")), opts({ bestQuality: true }));
    await vi.advanceTimersByTimeAsync(700);
    const resolved = await pending;
    expect(resolved.source.kind).toBe("url");
    expect(s.ytResolve).toHaveBeenCalledTimes(1);
  });
});

describe("sources and stored reasons", () => {
  it("a YouTube track resolves progressively and an unavailable resolve falls back", async () => {
    const s = setup({ yt: unavailable, match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null) });
    const resolved = await s.resolver.resolve(track(yid("a")), opts());
    expect(s.ytResolve.mock.calls[0][1]).toMatchObject({ progressive: true });
    expect(resolved.fallback).toMatchObject({ cause: "unavailable", usedSource: "soundcloud" });
  });

  it("an unknown id asks the cascade and plays the approved YouTube track, a miss fails unavailable", async () => {
    const hit = setup({ match: async () => ({ track: track(yid("m")), score: 90 }) });
    await hit.resolver.resolve(track("local-1"), opts());
    expect(hit.ytResolve.mock.calls[0][0].id).toBe(yid("m"));
    const miss = setup();
    await expect(miss.resolver.resolve(track("local-1"), opts())).rejects.toMatchObject({ cause: "unavailable" });
  });

  it("a direct SoundCloud descriptor is attached with its expiry", async () => {
    const at = Date.now() + 600_000;
    const s = setup({
      sc: async () => ({ kind: "direct", url: "u", expiresAt: at, codec: "aac", mimeType: "audio/mp4", bitrate: 128_000, contentLength: null }),
    });
    const resolved = await s.resolver.resolve(track("sc:9"), opts());
    expect(resolved.source.expiresAt).toBe(at);
  });

  it("/ finding 1: a bitrate choice is stored as bitrate and does not stay lasting in normal mode", async () => {
    const s = setup({ match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null) });
    const resolved = await s.resolver.resolve(track(yid("a")), opts({ bestQuality: true }));
    expect(resolved.stream.source).toBe("soundcloud");
    expect(resolved.fallback).toBeNull();
    expect(resolved.remember).toMatchObject({ reason: "bitrate", altId: "sc:1", durationMs: 200_000 });

    const normal = setup({ alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "bitrate" } });
    const plain = await normal.resolver.resolve(track(yid("a")), opts());
    expect(plain.stream.source).toBe("youtube");
    const best = await normal.resolver.resolve(track(yid("a")), opts({ bestQuality: true }));
    expect(best.stream.source).toBe("soundcloud");
  });

  it("best quality asks YouTube for hifi when the alternative or the fallback is on YouTube", async () => {
    const compared = setup({ match: async (target) => (target === "youtube" ? { track: track(yid("b")), score: 90 } : null) });
    await compared.resolver.resolve(track("sc:9"), opts({ bestQuality: true }));
    expect(compared.ytResolve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quality: "hifi" }), expect.anything());

    const normal = setup({ match: async (target) => (target === "youtube" ? { track: track(yid("b")), score: 90 } : null) });
    await normal.resolver.resolve(track("sc:9"), opts());
    expect(normal.ytResolve).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quality: "hifi" }), expect.anything());

    const fallback = setup({ alternative: { source: "youtube", altId: yid("b"), score: 90, reason: "unavailable" } });
    await fallback.resolver.fallback(track("sc:9"), "stall", "soundcloud", { positionMs: 0, bestQuality: true, signal: new AbortController().signal });
    expect(fallback.ytResolve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quality: "hifi" }), expect.anything());
  });

  it("at equal bitrate Opus beats AAC", async () => {
    const s = setup({ yt: async () => playable(160_000, "opus"), match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null) });
    const resolved = await s.resolver.resolve(track(yid("a")), opts({ bestQuality: true }));
    expect(resolved.stream.source).toBe("youtube");
  });

  it("a lasting remembered alternative plays first, a passing one only after the primary fails", async () => {
    const lasting = setup({ alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "unavailable" } });
    const first = await lasting.resolver.resolve(track(yid("a")), opts());
    expect(first.stream.source).toBe("soundcloud");
    expect(lasting.ytResolve).not.toHaveBeenCalled();
    expect(lasting.approvedOn).not.toHaveBeenCalled();

    const passing = setup({ alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "timeout", durationMs: 200_000 } });
    expect((await passing.resolver.resolve(track(yid("a")), opts())).stream.source).toBe("youtube");
    expect(passing.ytResolve).toHaveBeenCalledTimes(1);
  });

  it("confirm stores a new alternative with its reason", async () => {
    const s = setup({ yt: unavailable, match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null) });
    const t = track(yid("a"));
    const resolved = await s.resolver.resolve(t, opts());
    await s.resolver.confirm(t, resolved);
    expect(s.putAlternative).toHaveBeenCalledWith(t.id, expect.objectContaining({ altId: "sc:1", reason: "unavailable", score: 90 }));
  });

  it("a rejected alternative is skipped on the next play", async () => {
    const s = setup({ alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "unavailable" } });
    await s.resolver.reject(yid("a"), "sc:1");
    expect((await s.resolver.resolve(track(yid("a")), opts())).stream.source).toBe("youtube");
  });

  it("a chosen source is stored as pinned and plays again even after it was rejected", async () => {
    const s = setup({ alternative: { source: "soundcloud", altId: "sc:1", score: 100, reason: "pinned" } });
    await s.resolver.reject(yid("a"), "sc:1");
    await s.resolver.choose(yid("a"), { source: "soundcloud", altId: "sc:1", score: 100 });
    expect(s.putAlternative).toHaveBeenCalledWith(yid("a"), { source: "soundcloud", altId: "sc:1", score: 100, reason: "pinned" });
    expect((await s.resolver.resolve(track(yid("a")), opts())).stream.source).toBe("soundcloud");
  });
});

describe("fallback", () => {
  it("each trigger cause starts fallback with that cause", async () => {
    for (const cause of ["blocked", "timeout", "unavailable"] as const) {
      const s = setup({
        yt: () => Promise.reject(new SourceFailure(cause)),
        match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null),
      });
      expect((await s.resolver.resolve(track(yid("a")), opts())).fallback?.cause).toBe(cause);
    }
    for (const cause of ["media_error", "http_403", "stall"] as const) {
      const s = setup({ match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null) });
      const resolved = await s.resolver.fallback(track(yid("a")), cause, "youtube", {
        positionMs: 0,
        bestQuality: false,
        signal: new AbortController().signal,
      });
      expect(resolved.fallback?.cause).toBe(cause);
    }
  });

  it("offline does not search", async () => {
    const s = setup({ yt: () => Promise.reject(new SourceFailure("offline")) });
    await expect(s.resolver.resolve(track(yid("a")), opts())).rejects.toMatchObject({ cause: "offline" });
    expect(s.approvedOn).not.toHaveBeenCalled();
  });

  it("a remembered alternative plays without a search", async () => {
    const s = setup({ yt: unavailable, alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "timeout", durationMs: 200_000 } });
    const resolved = await s.resolver.resolve(track(yid("a")), opts());
    expect(resolved.stream.source).toBe("soundcloud");
    expect(s.approvedOn).not.toHaveBeenCalled();
  });

  it("only an approved outcome plays (the port returns nothing otherwise)", async () => {
    const s = setup({ yt: unavailable });
    await expect(s.resolver.resolve(track(yid("a")), opts())).rejects.toMatchObject({ cause: "unavailable" });
  });

  it("/ finding 9: both alternatives fail, the original cause stays in the failure", async () => {
    let n = 0;
    const s = setup({
      match: async () => scMatch(`sc:${++n}`),
      sc: () => Promise.reject(new SourceFailure("unavailable")),
    });
    const failure = await s.resolver
      .fallback(track(yid("a")), "stall", "youtube", { positionMs: 5000, bestQuality: false, signal: new AbortController().signal })
      .then(
        () => null,
        (error: unknown) => error as SourceFailure,
      );
    expect(failure).toBeInstanceOf(SourceFailure);
    if (!failure) return;
    expect(failure.cause).toBe("timeout");
    expect(failure.detail.original).toBe("stall");
    expect(s.approvedOn.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("a 2 s longer alternative keeps the position, a 5 s longer one restarts", async () => {
    const near = setup({ match: async () => scMatch("sc:1", 202_000) });
    const a = await near.resolver.fallback(track(yid("a")), "stall", "youtube", {
      positionMs: 70_000,
      bestQuality: false,
      signal: new AbortController().signal,
    });
    expect(a.startAtMs).toBe(70_000);
    expect(a.fallback?.restarted).toBe(false);
    const far = setup({ match: async () => scMatch("sc:1", 205_000) });
    const b = await far.resolver.fallback(track(yid("a")), "stall", "youtube", {
      positionMs: 70_000,
      bestQuality: false,
      signal: new AbortController().signal,
    });
    expect(b.startAtMs).toBe(0);
    expect(b.fallback?.restarted).toBe(true);
  });

  it("finding 4: a remembered alternative without a length restarts a mid-track resume", async () => {
    const s = setup({ alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "timeout" } });
    const resolved = await s.resolver.fallback(track(yid("a")), "stall", "youtube", {
      positionMs: 70_000,
      bestQuality: false,
      signal: new AbortController().signal,
    });
    expect(resolved.startAtMs).toBe(0);
    expect(resolved.fallback?.restarted).toBe(true);
  });

  it("finding 2: the lasting alternative is charged, so one search at most follows it", async () => {
    let n = 0;
    const s = setup({
      alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "unavailable", durationMs: 200_000 },
      yt: unavailable,
      sc: () => Promise.reject(new SourceFailure("unavailable")),
      match: async () => scMatch(`sc:${++n + 1}`),
    });
    await expect(s.resolver.resolve(track(yid("a")), opts())).rejects.toBeInstanceOf(SourceFailure);
    expect(s.daemon.scStream).toHaveBeenCalledTimes(2);
    expect(s.approvedOn).toHaveBeenCalledTimes(1);
  });

  it("finding 2: the 15 s budget starts when the primary has failed, not before it", async () => {
    const s = setup({
      yt: () => new Promise((_, reject) => setTimeout(() => reject({ code: "http", status: 404 }), 10_000)),
      match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null),
    });
    const pending = s.resolver.resolve(track(yid("a")), opts());
    await vi.advanceTimersByTimeAsync(10_100);
    expect((await pending).stream.source).toBe("soundcloud");
  });

  it("finding 3: the alternative that just failed is not tried again", async () => {
    const s = setup({
      alternative: { source: "soundcloud", altId: "sc:1", score: 90, reason: "unavailable", durationMs: 200_000 },
      match: async (_t, exclude) => (exclude?.has("sc:1") ? scMatch("sc:2") : scMatch("sc:1")),
    });
    const resolved = await s.resolver.fallback(track(yid("a")), "stall", "soundcloud", {
      positionMs: 1000,
      bestQuality: false,
      signal: new AbortController().signal,
      failedAlts: new Set(["sc:1"]),
    });
    expect(resolved.altId).toBe("sc:2");
    expect([...(s.approvedOn.mock.calls[0][3] ?? [])]).toContain("sc:1");
  });

  it("finding 5: a start that already missed the cache does not probe again in fallback", async () => {
    const s = setup({ yt: unavailable, match: async (target) => (target === "soundcloud" ? scMatch("sc:1") : null) });
    await s.resolver.resolve(track(yid("a")), opts());
    expect(s.probeCache).toHaveBeenCalledTimes(1);
  });

  it("a mid-track fallback plays the cache when the track is cached and the cache did not fail", async () => {
    const s = setup({ probe: async () => ({ codec: "opus", bitrateKbps: 128 }) });
    const resolved = await s.resolver.fallback(track(yid("a")), "stall", "youtube", {
      positionMs: 9000,
      bestQuality: false,
      signal: new AbortController().signal,
    });
    expect(resolved.source.kind).toBe("cache");
    expect(resolved.startAtMs).toBe(9000);
  });

  it("best quality replaces a 64 kbps cached copy with the 160 kbps network stream", async () => {
    const s = setup({ probe: async () => ({ codec: "opus", bitrateKbps: 64 }), yt: async () => playable(160_000) });
    const resolved = await s.resolver.resolve(track(yid("a")), opts({ bestQuality: true }));
    expect(resolved.source.kind).toBe("url");
    const normal = await s.resolver.resolve(track(yid("a")), opts());
    expect(normal.source.kind).toBe("cache");
  });
});

describe("FallbackBudget and youtubeCause", () => {
  it("allows two alternatives and fifteen seconds", () => {
    const budget = new FallbackBudget(() => Date.now());
    expect(budget.exhausted).toBe(false);
    budget.spend();
    budget.spend();
    expect(budget.exhausted).toBe(true);
    const timed = new FallbackBudget(() => Date.now());
    vi.advanceTimersByTime(14_999);
    expect(timed.exhausted).toBe(false);
    expect(timed.msLeft).toBe(1);
    vi.advanceTimersByTime(1);
    expect(timed.exhausted).toBe(true);
  });

  it("maps YouTube module errors to causes", () => {
    const cause = (error: unknown, online = true) => youtubeCause(error, online).cause;
    expect(youtubeCause({ code: "bot-check" }, true)).toMatchObject({ cause: "sign_in_required", detail: { botCheck: true } });
    expect(cause({ code: "sign-in-required" })).toBe("sign_in_required");
    expect(cause({ code: "unreachable" })).toBe("blocked");
    expect(cause({ code: "unreachable" }, false)).toBe("offline");
    expect(cause({ code: "http", status: 403 })).toBe("blocked");
    expect(cause({ code: "http", status: 429 })).toBe("rate_limited");
    expect(cause({ code: "http", status: 503 })).toBe("server_error");
    expect(cause({ code: "http", status: 404 })).toBe("unavailable");
    expect(cause({ code: "rejected-stream" })).toBe("not_audio");
    expect(cause({ code: "unsupported-mime" })).toBe("not_audio");
    expect(cause({ code: "worker-timeout" })).toBe("timeout");
    expect(cause({ code: "weird" })).toBe("unavailable");
    expect(cause({ code: "weird" }, false)).toBe("offline");
  });

  it("maps all-failed by its worst reason: bot check, then 403, then 429", () => {
    const cause = (error: unknown, online = true) => youtubeCause(error, online).cause;
    expect(youtubeCause({ code: "all-failed", botCheck: true, attempts: [{ code: "http", status: 403 }] }, true)).toMatchObject({
      cause: "sign_in_required",
      detail: { botCheck: true },
    });
    expect(
      youtubeCause(
        {
          code: "all-failed",
          botCheck: false,
          attempts: [
            { code: "http", status: 429 },
            { code: "http", status: 403 },
          ],
        },
        true,
      ),
    ).toMatchObject({ cause: "blocked", detail: { httpStatus: 403 } });
    expect(cause({ code: "all-failed", botCheck: false, attempts: [{ code: "no-formats" }, { code: "http", status: 429 }] })).toBe("rate_limited");
    expect(cause({ code: "all-failed", botCheck: false, attempts: [{ code: "no-formats" }] })).toBe("unavailable");
    expect(cause({ code: "all-failed", botCheck: false })).toBe("unavailable");
    expect(cause({ code: "all-failed", botCheck: false }, false)).toBe("offline");
  });
});

describe("best quality format", () => {
  it("asks YouTube for the hi-fi format only in best-quality mode", async () => {
    const s = setup();
    await s.resolver.resolve(track(yid("a")), opts({ bestQuality: true }));
    expect(s.ytResolve.mock.calls[0][1]).toMatchObject({ quality: "hifi" });
    const n = setup();
    await n.resolver.resolve(track(yid("b")), opts());
    expect(n.ytResolve.mock.calls[0][1]).toMatchObject({ quality: "normal" });
  });
});
