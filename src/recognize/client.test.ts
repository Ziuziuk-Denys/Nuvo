// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreError } from "@/links/core";
import { listen, startFailure } from "./client";

const sse = (...events: object[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("listen", () => {
  it("sends the source and hands over every event up to the answer", async () => {
    const fetch = vi.fn(async () => sse({ type: "stage", name: "fetching" }, { type: "notFound", more: false }, { type: "stage", name: "late" }));
    vi.stubGlobal("fetch", fetch);
    const seen: string[] = [];
    await listen({ file: "grant1" }, 1, new AbortController().signal, (event) => seen.push(event.type));
    expect(seen).toEqual(["stage", "notFound"]);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ file: "grant1", part: 1 });
  });

  it("reports a stream that ends without an answer as a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sse({ type: "stage", name: "fetching" })),
    );
    const seen: unknown[] = [];
    await listen({ system: true }, 0, new AbortController().signal, (event) => seen.push(event));
    expect(seen.at(-1)).toEqual({ type: "error", code: "network" });
  });
});

describe("startFailure", () => {
  it("names a locked library and a daemon that is down", () => {
    expect(startFailure(new CoreError(423, "LOCKED"))).toBe("locked");
    expect(startFailure(new CoreError(0, "core_down"))).toBe("core_down");
    expect(startFailure(new CoreError(503, "x"))).toBe("core_down");
    expect(startFailure(new Error("x"))).toBe("failed");
  });
});
