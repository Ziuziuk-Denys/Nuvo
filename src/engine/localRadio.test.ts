import { describe, expect, it, vi } from "vitest";
import { createContinuation, type CatalogPort } from "./adapters";
import type { MatchPort } from "./sources/ports";
import type { Track } from "./types";

const L = (c: string) => `local:${c.repeat(32)}`;
const snap = (id: string, artist = "A") => ({ id, title: id, artists: [{ id: "", name: artist }], durationMs: 1000 });
const t = (id: string): Track => ({ id, title: id, artists: "A", coverUrl: "", durationMs: 1000 });
const request = (seed: string) => ({ context: `radio:${seed}`, seeds: [seed], recent: [], sessionId: null, limit: 10 });

function daemon(related: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/local/related")) return new Response(JSON.stringify(related), { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("radio with local files", () => {
  it("a streamed seed gets local tracks by its artist mixed in", async () => {
    const catalog: CatalogPort = { searchFiltered: vi.fn(), radio: vi.fn(async () => [t("aaaaaaaaaaa")]) };
    const port = createContinuation("nuvo-core://local", catalog, daemon({ seed: snap("bbbbbbbbbbb"), items: [snap(L("1"))] }));
    const out = await port.next(request("bbbbbbbbbbb"));
    expect(out.map((x) => x.id)).toEqual(["aaaaaaaaaaa", L("1")]);
  });

  it("a local seed seeds the catalog radio with its YouTube match", async () => {
    const radio = vi.fn(async () => [t("ccccccccccc")]);
    const match: MatchPort = { approvedOn: vi.fn(async () => ({ track: t("ddddddddddd"), score: 90 })) };
    const port = createContinuation("nuvo-core://local", { searchFiltered: vi.fn(), radio }, daemon({ seed: snap(L("2")), items: [snap(L("3"))] }), match);
    const out = await port.next(request(L("2")));
    expect(radio).toHaveBeenCalledWith("ddddddddddd", expect.anything(), expect.anything());
    expect(out.map((x) => x.id)).toEqual(["ccccccccccc", L("3")]);
  });

  it("a local seed without a match still gets local tracks, and the catalog is not asked", async () => {
    const radio = vi.fn(async () => [t("ccccccccccc")]);
    const match: MatchPort = { approvedOn: vi.fn(async () => null) };
    const port = createContinuation("nuvo-core://local", { searchFiltered: vi.fn(), radio }, daemon({ seed: snap(L("2")), items: [snap(L("3"))] }), match);
    expect((await port.next(request(L("2")))).map((x) => x.id)).toEqual([L("3")]);
    expect(radio).not.toHaveBeenCalled();
  });
});
