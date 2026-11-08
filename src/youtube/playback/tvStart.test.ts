import { describe, expect, it, vi, beforeEach } from "vitest";

const recorded: { options?: Record<string, unknown>; aborted: number } = {
  aborted: 0,
};

vi.mock("googlevideo/sabr-stream", () => ({
  SabrStream: class {
    constructor(options: Record<string, unknown>) {
      recorded.options = options;
    }
    start() {
      return {
        audioStream: new ReadableStream<Uint8Array>(),
        selectedFormats: {
          audioFormat: {
            mimeType: "audio/webm",
            bitrate: 1,
            averageBitrate: 2,
          },
        },
      };
    }
    abort() {
      recorded.aborted += 1;
    }
  },
}));
vi.mock("googlevideo/utils", () => ({
  buildSabrFormat: (format: unknown) => format,
  EnabledTrackTypes: { AUDIO_ONLY: 1 },
  base64ToU8: () => new Uint8Array(),
}));

import { startSabr } from "./tv";

describe("startSabr", () => {
  beforeEach(() => {
    recorded.options = undefined;
    recorded.aborted = 0;
  });

  it("passes the token and url, wraps fetch, and abort delegates", async () => {
    const inner = vi.fn(async () => new Response(null));
    const handle = await startSabr({
      videoId: "v",
      formats: [],
      serverAbrStreamingUrl: "https://rr1---sn-t.googlevideo.com/videoplayback",
      ustreamerConfig: "cfg",
      clientVersion: "7.1",
      poToken: "TOK",
      fetch: inner,
    });
    const options = recorded.options!;
    expect(options.poToken).toBe("TOK");
    expect(options.serverAbrStreamingUrl).toBe("https://rr1---sn-t.googlevideo.com/videoplayback");
    expect(options.fetchFunction).not.toBe(inner);
    await (options.fetchFunction as typeof fetch)("https://rr1---sn-t.googlevideo.com/videoplayback");
    expect(inner).toHaveBeenCalledTimes(1);
    handle.abort();
    expect(recorded.aborted).toBe(1);
  });
});
