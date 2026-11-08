import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BUFFER_BYTES, MAX_EVENT_BYTES, putOffset, putOffsets, readLyricsStream, streamUrl, type Fetch } from "./stream";
import { flush } from "./test/fakes";
import { track } from "./test/events";
import type { StreamEvent } from "./types";

function fakeFetch(chunks: string[], status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: Fetch = async (url, init) => {
    calls.push({ url, init });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status });
  };
  return { fetcher, calls };
}

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const signal = () => new AbortController().signal;

describe("streamUrl", () => {
  it("1 carries the title, the first non-empty artist and a positive duration", () => {
    const withList = track("yt:abc", {
      title: "Morning Light",
      artistList: [
        { id: "", name: " " },
        { id: "n", name: "Nova" },
      ],
      durationMs: 200_000,
    });
    expect(streamUrl(withList)).toBe("nuvo-core://local/v1/tracks/yt%3Aabc/lyrics?title=Morning+Light&artist=Nova&durationMs=200000");
    expect(streamUrl(track("t", { title: "Song", artists: "Echo, Nova", durationMs: 0 }))).toBe("nuvo-core://local/v1/tracks/t/lyrics?title=Song&artist=Echo");
  });
});

describe("readLyricsStream", () => {
  it("RF1 events split across chunks and packed into one chunk", async () => {
    const { fetcher } = fakeFetch([
      'data: {"type":"meta',
      'data","track":{"id":"t"},"offsetMs":300}\n',
      '\ndata: {"type":"provider","provider":"lrclib","status":"not_found"}\n\ndata: {"type":"done","cached":false}\n\n: keep-alive\n\n',
    ]);
    expect(await collect(readLyricsStream(fetcher, "u", signal()))).toEqual([
      { type: "metadata", track: { id: "t" }, offsetMs: 300 },
      { type: "provider", provider: "lrclib", status: "not_found" },
      { type: "done", cached: false },
    ]);
  });

  it("reads the daemon's own event fixture", async () => {
    const file = path.resolve(__dirname, "../../core/crates/contracts/fixtures/lyrics-events.json");
    const fixture = JSON.parse(fs.readFileSync(file, "utf8")) as StreamEvent[];
    const { fetcher } = fakeFetch([fixture.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")]);
    const events = await collect(readLyricsStream(fetcher, "u", signal()));
    expect(events).toEqual(fixture);
    expect(events[0]).toMatchObject({ type: "metadata", offsetMs: 0 });
  });

  it("throws on a non-2xx answer", async () => {
    const { fetcher } = fakeFetch([], 423);
    await expect(collect(readLyricsStream(fetcher, "u", signal()))).rejects.toThrow("423");
  });

  it("passes the abort signal to the request", async () => {
    const { fetcher, calls } = fakeFetch(['data: {"type":"done","cached":true}\n\n']);
    const controller = new AbortController();
    await collect(readLyricsStream(fetcher, "u", controller.signal));
    expect(calls[0].init?.signal).toBe(controller.signal);
  });
});

const done = 'data: {"type":"done","cached":false}\n\n';

describe("readLyricsStream limits and line endings", () => {
  it("splits events on CRLF pairs, even when a pair is cut between chunks", async () => {
    const { fetcher } = fakeFetch(['data: {"type":"provider","provider":"a","status":"found"}\r\n\r', '\ndata: {"type":"done","cached":false}\r\n\r\n']);
    const events = await collect(readLyricsStream(fetcher, "u", signal()));
    expect(events.map((event) => event.type)).toEqual(["provider", "done"]);
  });

  it("errors out when one event grows past the event cap", async () => {
    const { fetcher } = fakeFetch([`data: ${"x".repeat(MAX_EVENT_BYTES + 1)}`]);
    await expect(collect(readLyricsStream(fetcher, "u", signal()))).rejects.toThrow("too large");
  });

  it("errors out when a finished event is over the event cap", async () => {
    const { fetcher } = fakeFetch([`data: {"type":"provider","message":"${"x".repeat(MAX_EVENT_BYTES)}"}\n\n`]);
    await expect(collect(readLyricsStream(fetcher, "u", signal()))).rejects.toThrow("too large");
  });

  it("errors out when one chunk is over the buffer cap", async () => {
    const small = 'data: {"type":"provider","provider":"a","status":"found"}\n\n';
    const { fetcher } = fakeFetch([small.repeat(Math.ceil(MAX_BUFFER_BYTES / small.length) + 1)]);
    await expect(collect(readLyricsStream(fetcher, "u", signal()))).rejects.toThrow("too large");
  });
});

describe("readLyricsStream reconnects", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function scripted(steps: Array<"fail" | "drop" | "ok" | number>) {
    let calls = 0;
    const fetcher: Fetch = async () => {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      if (step === "fail") throw new TypeError("network down");
      if (typeof step === "number") return new Response(null, { status: step });
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(step === "ok" ? done : 'data: {"type":"provider","provider":"a","status":"found"}\n\n'));
          controller.close();
        },
      });
      return new Response(body);
    };
    return { fetcher, count: () => calls };
  }

  async function drain(promise: Promise<StreamEvent[]>) {
    for (let index = 0; index < 5; index += 1) {
      await flush();
      await vi.advanceTimersByTimeAsync(2000);
    }
    return promise;
  }

  it("retries a dropped connection and a stream that ends without done", async () => {
    const s = scripted(["fail", "drop", "ok"]);
    const events = await drain(collect(readLyricsStream(s.fetcher, "u", signal())));
    expect(s.count()).toBe(3);
    expect(events.at(-1)).toEqual({ type: "done", cached: false });
  });

  it("retries a 5xx answer but not a 4xx answer", async () => {
    const server = scripted([503, "ok"]);
    await drain(collect(readLyricsStream(server.fetcher, "u", signal())));
    expect(server.count()).toBe(2);
    const client = scripted([423, "ok"]);
    const result = collect(readLyricsStream(client.fetcher, "u", signal()));
    result.catch(() => undefined);
    await expect(drain(result)).rejects.toThrow("423");
    expect(client.count()).toBe(1);
  });

  it("gives up after three reconnects and reports the error", async () => {
    const s = scripted(["fail"]);
    const result = collect(readLyricsStream(s.fetcher, "u", signal()));
    result.catch(() => undefined);
    await expect(drain(result)).rejects.toThrow("network down");
    expect(s.count()).toBe(4);
  });

  it("never reconnects after an abort, also while waiting to reconnect", async () => {
    const controller = new AbortController();
    const s = scripted(["fail"]);
    const result = collect(readLyricsStream(s.fetcher, "u", controller.signal));
    result.catch(() => undefined);
    await flush();
    controller.abort();
    await expect(drain(result)).rejects.toThrow();
    expect(s.count()).toBe(1);

    const aborted = new AbortController();
    aborted.abort();
    const again = scripted(["fail"]);
    const second = collect(readLyricsStream(again.fetcher, "u", aborted.signal));
    second.catch(() => undefined);
    await expect(drain(second)).rejects.toThrow();
    expect(again.count()).toBeLessThanOrEqual(1);
  });
});

describe("offset writes", () => {
  it("sends one PUT per call and throws when the daemon refuses", async () => {
    const ok = fakeFetch([]);
    await putOffset(ok.fetcher, "yt:abc", 500);
    expect(ok.calls[0].url).toBe("nuvo-core://local/v1/tracks/yt%3Aabc/lyrics/offset");
    expect(ok.calls[0].init).toMatchObject({ method: "PUT", body: JSON.stringify({ offsetMs: 500 }) });
    await putOffsets(ok.fetcher, { a: 300 });
    expect(ok.calls[1].url).toBe("nuvo-core://local/v1/lyrics/offsets");
    expect(ok.calls[1].init?.body).toBe(JSON.stringify({ offsets: { a: 300 } }));
    await expect(putOffset(fakeFetch([], 503).fetcher, "t", 1)).rejects.toThrow("503");
  });
});
