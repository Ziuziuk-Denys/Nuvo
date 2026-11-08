import { describe, expect, it } from "vitest";
import { betterFormat, cacheGoodEnough, alternativeStart, isFallbackTrigger, isLastingReason } from "./fallbackPlan";
import { checkCacheWrite } from "./sniff";

describe("cache write checks", () => {
  it("fragments, partial downloads and HTML are refused", async () => {
    const fragment = new Blob([new Uint8Array([0, 0, 0, 24, 0x6d, 0x6f, 0x6f, 0x66])]);
    expect(await checkCacheWrite(fragment, "audio/mp4")).toBe(false);
    const partial = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]);
    expect(await checkCacheWrite(partial, "audio/webm", "bytes 0-3/1000000")).toBe(false);
    expect(await checkCacheWrite(new Blob(["<html>"]), "text/html")).toBe(false);
    expect(await checkCacheWrite(partial, "audio/webm")).toBe(true);
  });
});

describe("fallback decisions", () => {
  it("triggers, lasting reasons and formats", () => {
    expect(isFallbackTrigger("unavailable")).toBe(true);
    expect(isFallbackTrigger("offline")).toBe(false);
    expect(isLastingReason("drm", false)).toBe(true);
    expect(isLastingReason("timeout", false)).toBe(false);
    expect(isLastingReason("bitrate", true)).toBe(true);
    expect(betterFormat({ codec: "opus", bitrateKbps: 160 }, { codec: "mp4a.40.2", bitrateKbps: 160 })).toBe(true);
    expect(betterFormat({ codec: "aac", bitrateKbps: 160 }, { codec: "opus", bitrateKbps: 128 })).toBe(true);
    expect(cacheGoodEnough(null, 160)).toBe(true);
    expect(cacheGoodEnough(64, 160)).toBe(false);
    expect(alternativeStart(70_000, 200_000, 202_000)).toEqual({ startAtMs: 70_000, restarted: false });
    expect(alternativeStart(70_000, 200_000, 205_000)).toEqual({ startAtMs: 0, restarted: true });
  });
});

describe("partial downloads", () => {
  it("an unknown total in content-range is partial", async () => {
    const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]);
    expect(await checkCacheWrite(webm, "audio/webm", "bytes 0-3/*")).toBe(false);
    expect(await checkCacheWrite(webm, "audio/webm", "bytes 0-3/4")).toBe(true);
  });
});
