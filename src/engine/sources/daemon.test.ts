import { describe, expect, it } from "vitest";
import { createDaemonClient } from "./daemon";
import { SourceFailure } from "./ports";

const client = (handler: () => Promise<Response> | Response) => createDaemonClient("http://d", (async () => handler()) as unknown as typeof fetch);
const down = () =>
  createDaemonClient("http://d", (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch);

describe("daemon client mappings", () => {
  it("fetchStatus tells unreachable, unknown job, server error and a job apart", async () => {
    expect(await down().fetchStatus("t")).toEqual({ http: 0, job: null });
    expect(await client(() => new Response("", { status: 404 })).fetchStatus("t")).toEqual({ http: 404, job: null });
    expect(await client(() => new Response("", { status: 500 })).fetchStatus("t")).toEqual({ http: 500, job: null });
    const job = { state: "fetching", bytes: 5 };
    expect(await client(() => Response.json(job)).fetchStatus("t")).toEqual({ http: 200, job });
  });

  it("scStream reads expiresAt as an ISO time and gives Unix ms; null and garbage stay unknown", async () => {
    const signal = new AbortController().signal;
    const descriptor = (expiresAt: unknown) =>
      client(() =>
        Response.json({ kind: "direct", url: "u", expiresAt, codec: "mp3", mimeType: "audio/mpeg", bitrate: 128_000, contentLength: null }),
      ).scStream("1", signal);
    expect((await descriptor("2030-03-17T17:46:40.000Z")).expiresAt).toBe(1_900_000_000_000);
    expect((await descriptor(null)).expiresAt).toBeNull();
    expect((await descriptor("soon")).expiresAt).toBeNull();
  });

  it("startFetch returns the HTTP status, 0 when unreachable", async () => {
    const job = { trackId: "t", url: "u", mime: "audio/webm", codec: "opus", bitrateKbps: 128 };
    expect(await down().startFetch(job)).toBe(0);
    expect(await client(() => new Response("", { status: 409 })).startFetch(job)).toBe(409);
    expect(await client(() => new Response("", { status: 202 })).startFetch(job)).toBe(202);
  });

  it("scStream maps statuses, a timeout, a dead daemon and a broken body", async () => {
    const signal = new AbortController().signal;
    const failure = async (c: ReturnType<typeof client>): Promise<SourceFailure> => {
      try {
        await c.scStream("1", signal);
      } catch (error) {
        return error as SourceFailure;
      }
      throw new Error("expected a failure");
    };
    expect((await failure(client(() => new Response("", { status: 429 })))).cause).toBe("rate_limited");
    expect((await failure(client(() => new Response("", { status: 503 })))).cause).toBe("timeout");
    expect((await failure(client(() => new Response("", { status: 502 })))).cause).toBe("server_error");
    expect((await failure(client(() => new Response("", { status: 404 })))).cause).toBe("unavailable");
    expect((await failure(down())).cause).toBe("unavailable");
    expect((await failure(client(() => new Response("{nope", { status: 200 })))).cause).toBe("server_error");
    const timedOut = createDaemonClient("http://d", (async () => {
      throw new DOMException("t", "TimeoutError");
    }) as unknown as typeof fetch);
    expect((await failure(timedOut)).cause).toBe("timeout");
    const aborted = createDaemonClient("http://d", (async () => {
      throw new DOMException("a", "AbortError");
    }) as unknown as typeof fetch);
    expect((await failure(aborted)).name).toBe("AbortError");
  });

  it("an empty entry is a miss; an unreachable daemon is a miss", async () => {
    const empty = client(() => new Response("", { status: 206, headers: { "content-range": "bytes 0-0/0" } }));
    expect(await empty.probeCache("t")).toBeNull();
    expect(await down().probeCache("t")).toBeNull();
    const hit = client(() => new Response("x", { status: 206, headers: { "x-nuvo-codec": "opus", "x-nuvo-bitrate": "160", "content-range": "bytes 0-0/9" } }));
    expect(await hit.probeCache("t")).toEqual({ codec: "opus", bitrateKbps: 160 });
  });
});
