// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { createSearchHistory, LEGACY_HISTORY_KEY } from "./history";

const BASE = "nuvo-core://local";
const LIST = "/v1/me/search-history";
type Handler = (body: Record<string, unknown> | undefined) => Response | Promise<Response>;

let handlers: Map<string, Handler>;
let calls: Array<{ method: string; path: string; body: Record<string, unknown> | undefined }>;
let history: ReturnType<typeof createSearchHistory>;

const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const path = String(input).slice(BASE.length);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
  calls.push({ method, path, body });
  const handler = handlers.get(`${method} ${path.split("?")[0]}`);
  return handler ? handler(body) : new Response(null, { status: 503 });
}) as typeof fetch;

// Response bodies settle over real stream ticks, so wait on timers, not a fixed count of microtasks
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
let nextId = 0;
const stored = () => Response.json({ id: `e${(nextId += 1)}`, kind: "query", at: "2026-11-01T10:00:00Z" });

beforeEach(() => {
  localStorage.clear();
  handlers = new Map();
  calls = [];
  nextId = 0;
  history = createSearchHistory({ base: BASE, fetch: fetchFake, storage: () => localStorage, now: () => 1000 });
});

afterEach(() => vi.restoreAllMocks());

const state = () => history.useSearchHistoryStore.getState();

describe("search history", () => {
  it("files a typed query and a picked song in the daemon, newest first", async () => {
    handlers.set(`POST ${LIST}`, stored);
    state().addItem({ id: "query:queen", type: "query", title: "queen" });
    state().addItem({ id: "s1", type: "track", title: "Song", subtitle: "Queen", coverUrl: "c", durationMs: 1000, itemData: { id: "s1" } });
    expect(state().items.map((item) => item.id)).toEqual(["s1", "query:queen"]);
    await flush();
    expect(calls.map((call) => call.body)).toEqual([
      { kind: "query", query: "queen" },
      { kind: "track", item: { id: "s1", title: "Song", subtitle: "Queen", coverUrl: "c", durationMs: 1000, itemData: { id: "s1" } } },
    ]);
    expect(state().items.map((item) => item.entryId)).toEqual(["e2", "e1"]);
  });

  it("removing an entry right after picking it deletes the daemon row once the post lands (Review Focus 3)", async () => {
    let land!: () => void;
    handlers.set(`POST ${LIST}`, () => new Promise<Response>((resolve) => (land = () => resolve(Response.json({ id: "e7" })))));
    handlers.set(`DELETE ${LIST}/e7`, () => new Response(null, { status: 204 }));
    state().addItem({ id: "al1", type: "album", title: "Opera" });
    state().removeItem("al1");
    expect(state().items).toEqual([]);
    land();
    await flush();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST ${LIST}`, `DELETE ${LIST}/e7`]);
  });

  it("clears after posts in flight have landed", async () => {
    let land!: () => void;
    handlers.set(`POST ${LIST}`, () => new Promise<Response>((resolve) => (land = () => resolve(Response.json({ id: "e1" })))));
    handlers.set(`DELETE ${LIST}`, () => new Response(null, { status: 204 }));
    state().addItem({ id: "query:a", type: "query", title: "a" });
    state().clearHistory();
    await flush();
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
    land();
    await flush();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST ${LIST}`, `DELETE ${LIST}`]);
  });

  it("loads the daemon list and maps it back; unsent entries stay on top", async () => {
    handlers.set(`GET ${LIST}`, () =>
      Response.json({
        items: [
          { id: "e2", kind: "query", query: "Daft  Punk", at: "2026-11-01T10:00:02Z" },
          { id: "e1", kind: "album", item: { id: "al1", title: "Discovery", subtitle: "Daft Punk", coverUrl: "c" }, at: "2026-11-01T10:00:01Z" },
          { id: "bad", kind: "album", item: { title: "no id" }, at: "2026-11-01T10:00:00Z" },
        ],
      }),
    );
    state().addItem({ id: "query:local", type: "query", title: "local" });
    await history.loadSearchHistory();
    expect(state().items.map((item) => [item.id, item.title, item.entryId])).toEqual([
      ["query:local", "local", undefined],
      ["query:daft punk", "Daft  Punk", "e2"],
      ["al1", "Discovery", "e1"],
    ]);
    expect(calls.find((call) => call.method === "GET")?.path).toBe(`${LIST}?limit=30`);
  });

  it("moves the old local list into the daemon oldest first, then deletes the key", async () => {
    handlers.set(`POST ${LIST}`, stored);
    handlers.set(`GET ${LIST}`, () => Response.json({ items: [] }));
    localStorage.setItem(
      LEGACY_HISTORY_KEY,
      JSON.stringify({
        state: {
          items: [
            { id: "query:b", type: "query", title: "b", timestamp: 2 },
            { id: "t1", type: "track", title: "Song", subtitle: "X", timestamp: 1 },
          ],
        },
        version: 0,
      }),
    );
    await history.loadSearchHistory();
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      { kind: "track", item: { id: "t1", title: "Song", subtitle: "X" } },
      { kind: "query", query: "b" },
    ]);
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
  });

  it("keeps the old list while the library is locked, and finishes on a later load", async () => {
    handlers.set(`POST ${LIST}`, () => new Response(null, { status: 423 }));
    handlers.set(`GET ${LIST}`, () => new Response(null, { status: 423 }));
    const raw = JSON.stringify({ state: { items: [{ id: "query:a", type: "query", title: "a", timestamp: 1 }] }, version: 0 });
    localStorage.setItem(LEGACY_HISTORY_KEY, raw);
    await history.loadSearchHistory();
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBe(raw);
    handlers.set(`POST ${LIST}`, stored);
    handlers.set(`GET ${LIST}`, () => Response.json({ items: [] }));
    await history.loadSearchHistory();
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
  });

  it("skips an old entry the daemon refuses instead of retrying it forever", async () => {
    let posts = 0;
    handlers.set(`POST ${LIST}`, () => ((posts += 1) === 1 ? new Response(null, { status: 400 }) : stored()));
    handlers.set(`GET ${LIST}`, () => Response.json({ items: [] }));
    localStorage.setItem(
      LEGACY_HISTORY_KEY,
      JSON.stringify([
        { id: "query:new", type: "query", title: "new" },
        { id: "query:old", type: "query", title: "old" },
      ]),
    );
    await history.loadSearchHistory();
    expect(posts).toBe(2);
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
  });

  it("after a partial failure posts only what the daemon does not hold yet", async () => {
    let posts = 0;
    handlers.set(`POST ${LIST}`, () => ((posts += 1) === 1 ? stored() : new Response(null, { status: 503 })));
    handlers.set(`GET ${LIST}`, () => Response.json({ items: [] }));
    const raw = JSON.stringify([
      { id: "query:b", type: "query", title: "b" },
      { id: "query:a", type: "query", title: "a" },
    ]);
    localStorage.setItem(LEGACY_HISTORY_KEY, raw);
    await history.loadSearchHistory();
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBe(raw);
    calls = [];
    handlers.set(`POST ${LIST}`, stored);
    handlers.set(`GET ${LIST}`, () => Response.json({ items: [{ id: "e1", kind: "query", query: "a", at: "2026-11-01T10:00:00Z" }] }));
    await history.loadSearchHistory();
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([{ kind: "query", query: "b" }]);
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
  });

  it("keeps the old key and posts nothing when the daemon list cannot be read", async () => {
    handlers.set(`POST ${LIST}`, stored);
    handlers.set(`GET ${LIST}`, () => new Response(null, { status: 503 }));
    const raw = JSON.stringify([{ id: "query:a", type: "query", title: "a" }]);
    localStorage.setItem(LEGACY_HISTORY_KEY, raw);
    await history.loadSearchHistory();
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBe(raw);
  });

  it("survives a storage that refuses to remove the old key", async () => {
    handlers.set(`POST ${LIST}`, stored);
    handlers.set(`GET ${LIST}`, () => Response.json({ items: [] }));
    localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([{ id: "query:a", type: "query", title: "a" }]));
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(history.loadSearchHistory()).resolves.toBeUndefined();
  });

  it("never writes search terms to localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    handlers.set(`POST ${LIST}`, stored);
    state().addItem({ id: "query:secret", type: "query", title: "secret" });
    state().removeItem("query:secret");
    await flush();
    expect(setItem).not.toHaveBeenCalled();
  });
});
