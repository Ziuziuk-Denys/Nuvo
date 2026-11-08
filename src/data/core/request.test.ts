import { describe, expect, it, vi, afterEach } from "vitest";
import { CoreError } from "@/imports/core";
import { CORE_TIMEOUT_MS, coreRequest } from "./request";

afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body?: unknown) {
  return vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

describe("coreRequest", () => {
  it("sends JSON to the daemon origin and parses the answer", async () => {
    const fetchMock = answer(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(coreRequest("POST", "/v1/x", { a: 1 })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("nuvo-core://local/v1/x", expect.objectContaining({ method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } }));
  });

  it("204 resolves to undefined", async () => {
    vi.stubGlobal("fetch", answer(204));
    await expect(coreRequest("DELETE", "/v1/x")).resolves.toBeUndefined();
  });

  it("an error answer throws CoreError with the body code, else HTTP_<status>", async () => {
    vi.stubGlobal("fetch", answer(423, { code: "LOCKED", reqId: "r" }));
    await expect(coreRequest("GET", "/v1/x")).rejects.toEqual(new CoreError(423, "LOCKED"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(coreRequest("GET", "/v1/x")).rejects.toEqual(new CoreError(500, "HTTP_500"));
  });

  it("no answer throws CoreError 0 CORE_DOWN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed"); }));
    await expect(coreRequest("GET", "/v1/x")).rejects.toEqual(new CoreError(0, "CORE_DOWN"));
  });

  it("423 and 503 are distinct error kinds", async () => {
    vi.stubGlobal("fetch", answer(423));
    await expect(coreRequest("GET", "/v1/x")).rejects.toMatchObject({ kind: "locked" });
    vi.stubGlobal("fetch", answer(503));
    await expect(coreRequest("GET", "/v1/x")).rejects.toMatchObject({ kind: "starting" });
    vi.stubGlobal("fetch", answer(500));
    await expect(coreRequest("GET", "/v1/x")).rejects.toMatchObject({ kind: "http" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed"); }));
    await expect(coreRequest("GET", "/v1/x")).rejects.toMatchObject({ kind: "down" });
  });

  it("a hung daemon times out with an abort and a timeout error", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }));
      const call = coreRequest("GET", "/v1/x");
      const caught = call.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(CORE_TIMEOUT_MS + 1);
      expect(seen?.aborted).toBe(true);
      expect(await caught).toMatchObject({ kind: "timeout", status: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the caller's own abort passes through unchanged", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))));
    const call = coreRequest("GET", "/v1/x", undefined, controller.signal);
    const caught = call.catch((error: unknown) => error);
    controller.abort();
    expect(await caught).toMatchObject({ name: "AbortError" });
  });

  it("never puts the token in an error", async () => {
    vi.stubGlobal("fetch", answer(401, { code: "UNAUTHORIZED" }));
    const error = await coreRequest("GET", "/v1/x", undefined, undefined, { authorization: "Bearer secret-token" }).catch((e: unknown) => e as Error);
    expect(String(error) + JSON.stringify(error)).not.toContain("secret-token");
  });
});
