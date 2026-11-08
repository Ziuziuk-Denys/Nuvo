// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { CoreError, inspectLink, recognizeLink, soundcloudTrack, startImport } from "./core";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("daemon calls", () => {
  it("posts JSON through the core bridge", async () => {
    const fetch = vi.fn(async () =>
      json(200, {
        kind: "media",
        canonicalUrl: "https://x.test/a",
        media: { isLive: false },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const answer = await inspectLink("https://x.test/a", new AbortController().signal);
    expect(answer).toMatchObject({ kind: "media" });
    expect(fetch).toHaveBeenCalledWith(
      "nuvo-core://local/v1/links/inspect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://x.test/a" }),
      }),
    );
  });

  it("turns error bodies, an unreachable daemon and a 404 track into plain answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(400, { code: "INVALID_INPUT", message: "label is required" })),
    );
    await expect(startImport({ source: "nuvo-link", label: "", rows: [] }, new AbortController().signal)).rejects.toEqual(new CoreError(400, "INVALID_INPUT"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(inspectLink("https://x.test", new AbortController().signal)).rejects.toMatchObject({ status: 0, code: "core_down" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(404, { code: "NOT_FOUND" })),
    );
    expect(await soundcloudTrack("sc:1", new AbortController().signal)).toBeNull();
  });

  it("passes an abort through unchanged", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(inspectLink("https://x.test", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the recognize stream", () => {
  it("reports the listening stage and returns the result, across split chunks", async () => {
    const events = [
      ": keep-alive\n\n",
      'data: {"type":"stage","name":"resolving"}\n\n',
      'data: {"type":"stage","name":"listening","attempt":1,"of":3,"via":"clean","envelope":[]}\n\ndata: {"type":"res',
      'ult","id":"r1","track":{"title":"I Will Survive","artist":"Gloria Gaynor","isrc":"USPR37900020","via":"clean","input":{"kind":"link","label":"x"}}}\n\n',
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream(events), { status: 200 })),
    );
    const heard: string[] = [];
    const result = await recognizeLink("https://www.tiktok.com/@i/video/7000000000000000011", 0, new AbortController().signal, (via) => heard.push(via));
    expect(heard).toEqual(["clean"]);
    expect(result).toEqual({
      kind: "found",
      title: "I Will Survive",
      artist: "Gloria Gaynor",
      isrc: "USPR37900020",
      via: "clean",
    });
  });

  it("returns not found with the more flag, an error code, or network when the stream just ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream(['data: {"type":"hint","title":"t","artist":"a"}\n\ndata: {"type":"notFound","more":true}\n\n']))),
    );
    expect(await recognizeLink("https://x.test", 0, new AbortController().signal, () => undefined)).toEqual({ kind: "not_found", more: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream(['data: {"type":"error","code":"tool_missing"}\n\n']))),
    );
    expect(await recognizeLink("https://x.test", 1, new AbortController().signal, () => undefined)).toEqual({ kind: "error", code: "tool_missing" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream([]))),
    );
    expect(await recognizeLink("https://x.test", 0, new AbortController().signal, () => undefined)).toEqual({ kind: "error", code: "network" });
  });
});

describe("hostile streams", () => {
  const run = () => recognizeLink("https://x.test", 0, new AbortController().signal, () => undefined);

  it("skips a malformed event and keeps reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream(["data: null\n\n", "data: {oops\n\n", 'data: {"type":"notFound"}\n\n']))),
    );
    expect(await run()).toEqual({ kind: "not_found", more: false });
  });

  it("gives up on an event that never ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream(["data: " + "x".repeat(300_000)]))),
    );
    expect(await run()).toEqual({ kind: "error", code: "network" });
  });

  it("parses a last event that has no blank line after it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream(['data: {"type":"notFound","more":true}']))),
    );
    expect(await run()).toEqual({ kind: "not_found", more: true });
  });

  it("drains complete events before it applies the size cap", async () => {
    const big = JSON.stringify({ type: "hint", pad: "x".repeat(200_000) });
    const chunk = `data: ${big}\n\n` + `data: ${big}\n\n` + 'data: {"type":"notFound"}\n\n';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream([chunk]))),
    );
    expect(await run()).toEqual({ kind: "not_found", more: false });
  });

  it("rejects with the abort when the signal fires mid-stream", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body)),
    );
    await expect(recognizeLink("https://x.test", 0, controller.signal, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps a 200 with a broken body to an upstream error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    await expect(inspectLink("https://x.test", new AbortController().signal)).rejects.toEqual(new CoreError(200, "UPSTREAM"));
  });
});
