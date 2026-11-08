import { describe, expect, it } from "vitest";
import { streamFormat } from "./streamFormat";

describe("streamFormat", () => {
  it("reports the playing stream in bit/s, and nothing for a cached file or no stream", () => {
    expect(streamFormat({ source: "youtube", codec: "opus", bitrateKbps: 160, fromCache: false })).toEqual({ codec: "opus", bitrate: 160_000 });
    expect(streamFormat({ source: "cache", codec: "", bitrateKbps: 0, fromCache: true })).toBeNull();
    expect(streamFormat(null)).toBeNull();
  });
});
