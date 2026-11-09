import { describe, expect, it, vi } from "vitest";
import { createBindingsClient, DEFAULT_BINDINGS, migrateLegacyBindings, toStoredBindings } from "./bindings";

const legacy = (state: unknown) => JSON.stringify({ state, version: 0 });

describe("migrateLegacyBindings", () => {
  it("maps the old fields, keeps only real changes and ignores other scopes (test 40)", () => {
    const raw = legacy({
      global: { quickLikeSong: "Alt+Shift+J" },
      mainApp: { playPause: "P", nextTrack: "Control+Right" },
      miniplayer: { playPause: "Space" },
    });
    expect(migrateLegacyBindings(raw)).toEqual({ version: 1, app: { "player.toggle": "P" }, global: { "library.like-toggle": "Alt+Shift+J" } });
  });

  it("stores Cyrillic letters as their key position (test 41)", () => {
    expect(migrateLegacyBindings(legacy({ mainApp: { playPause: "Control+д" } }))?.app).toEqual({ "player.toggle": "Control+L" });
  });

  it("drops values that do not parse and empty values (test 42)", () => {
    expect(migrateLegacyBindings(legacy({ mainApp: { playPause: "Hyper+P", toggleMute: "" } }))).toEqual({ version: 1, app: {}, global: {} });
  });

  it("keeps the global binding when an in-app one clashes with it", () => {
    const raw = legacy({ global: { quickLikeSong: "Control+K" }, mainApp: { search: "Alt+Shift+L" } });
    const migrated = migrateLegacyBindings(raw, { ...DEFAULT_BINDINGS, "app.palette": { app: "Control+K", global: null } });
    expect(migrated?.global).toEqual({ "library.like-toggle": "Control+K" });
    expect(migrated?.app).toEqual({ "app.palette": null, "nav.search": "Alt+Shift+L" });
  });

  it("is null without the key and empty for garbage", () => {
    expect(migrateLegacyBindings(null)).toBeNull();
    expect(migrateLegacyBindings("{not json")).toEqual({ version: 1, app: {}, global: {} });
    expect(migrateLegacyBindings("null")).toEqual({ version: 1, app: {}, global: {} });
  });
});

describe("toStoredBindings", () => {
  it("accepts version 1 and drops entries that are not strings or null", () => {
    expect(toStoredBindings({ version: 1, app: { a: "P", b: null, c: 3 }, global: null })).toEqual({ version: 1, app: { a: "P", b: null }, global: {} });
    expect(toStoredBindings({ version: 2, app: {}, global: {} })).toBeNull();
    expect(toStoredBindings(null)).toBeNull();
  });
});

describe("createBindingsClient", () => {
  const BASE = "nuvo-core://local";

  it("reads the stored copy, or null when there is none", async () => {
    const fetch = vi.fn(async () => Response.json({ bindings: { version: 1, app: { "player.toggle": "P" }, global: {} } }));
    expect(await createBindingsClient(BASE, fetch as unknown as typeof globalThis.fetch).load()).toEqual({
      state: "ok",
      bindings: { version: 1, app: { "player.toggle": "P" }, global: {} },
    });
    expect(fetch).toHaveBeenCalledWith(`${BASE}/v1/shortcuts`);
    const empty = vi.fn(async () => Response.json({ bindings: null }));
    expect(await createBindingsClient(BASE, empty as unknown as typeof globalThis.fetch).load()).toEqual({ state: "ok", bindings: null });
  });

  it("is unavailable when the library is locked or the daemon is down", async () => {
    const locked = vi.fn(async () => new Response(null, { status: 423 }));
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await createBindingsClient(BASE, locked as unknown as typeof globalThis.fetch).load()).toEqual({ state: "unavailable" });
    expect(await createBindingsClient(BASE, down as unknown as typeof globalThis.fetch).load()).toEqual({ state: "unavailable" });
  });

  it("saves with PUT and reports failure", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const bindings = { version: 1 as const, app: { "player.toggle": "P" }, global: {} };
    expect(await createBindingsClient(BASE, fetch as unknown as typeof globalThis.fetch).save(bindings)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/v1/shortcuts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bindings),
    });
    const refused = vi.fn(async () => new Response(null, { status: 400 }));
    expect(await createBindingsClient(BASE, refused as unknown as typeof globalThis.fetch).save(bindings)).toBe(false);
  });
});
