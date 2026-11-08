import { describe, expect, it, vi, afterEach } from "vitest";
import { coreApi } from "./coreApi";

afterEach(() => vi.unstubAllGlobals());

function daemon(routes: Record<string, unknown>) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("nuvo-core://local", "")}`;
      seen.push(key + (init?.body ? ` ${init.body}` : ""));
      return key in routes ? new Response(routes[key] === null ? null : JSON.stringify(routes[key]), { status: routes[key] === null ? 204 : 200 }) : new Response(null, { status: 404 });
    }),
  );
  return seen;
}

describe("coreApi", () => {
  it("health, phrase, confirm and restore", async () => {
    const seen = daemon({ "GET /health": { status: "ok", locked: true }, "GET /v1/recovery/phrase": { phrase: "a b c" }, "POST /v1/recovery/confirm": null, "POST /v1/recovery/restore": null });
    await expect(coreApi.health()).resolves.toEqual({ status: "ok", locked: true });
    await expect(coreApi.recoveryPhrase()).resolves.toBe("a b c");
    await coreApi.confirmPhrase();
    await coreApi.restore("x y z");
    expect(seen.at(-1)).toBe('POST /v1/recovery/restore {"phrase":"x y z"}');
  });

  it("an empty library has no liked track and no playlist", async () => {
    daemon({ "GET /v1/me/library/tracks?limit=1": { items: [], nextCursor: null }, "GET /v1/me/playlists": { items: [] } });
    await expect(coreApi.isLibraryEmpty()).resolves.toBe(true);
    daemon({ "GET /v1/me/library/tracks?limit=1": { items: [], nextCursor: null }, "GET /v1/me/playlists": { items: [{ id: "p" }] } });
    await expect(coreApi.isLibraryEmpty()).resolves.toBe(false);
  });
});
