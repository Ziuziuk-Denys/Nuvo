// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CLEANUP_DONE_KEY, cleanupLegacyCovers, type CleanupEnv } from "./legacyCleanup";

function env(overrides: Partial<CleanupEnv> = {}) {
  const unregister = vi.fn(async () => true);
  const remove = vi.fn(async (_name: string) => true);
  const value: CleanupEnv = {
    storage: localStorage,
    serviceWorker: { getRegistrations: async () => [{ unregister }] },
    caches: { keys: async () => ["nuvo-covers-v2", "nuvo-covers-v1", "other-cache"], delete: remove },
    ...overrides,
  };
  return { value, unregister, remove };
}

beforeEach(() => localStorage.clear());

describe("cleanupLegacyCovers", () => {
  it("unregisters the worker, drops cover caches and old keys, once (covers test 31)", async () => {
    localStorage.setItem("nuvo:cover:abc", "1");
    localStorage.setItem("nuvo:playlist-covers", "x");
    localStorage.setItem("nuvo.ui.trackDoubleClick", "play");
    const { value, unregister, remove } = env();
    expect(await cleanupLegacyCovers(value)).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.map(([name]) => name)).toEqual(["nuvo-covers-v2", "nuvo-covers-v1"]);
    expect(localStorage.getItem("nuvo:cover:abc")).toBeNull();
    expect(localStorage.getItem("nuvo:playlist-covers")).toBeNull();
    expect(localStorage.getItem("nuvo.ui.trackDoubleClick")).toBe("play");
    expect(await cleanupLegacyCovers(value)).toBe(false);
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("tries again on the next start when a step fails", async () => {
    const broken = env({ serviceWorker: { getRegistrations: () => Promise.reject(new Error("denied")) } });
    expect(await cleanupLegacyCovers(broken.value)).toBe(false);
    expect(localStorage.getItem(CLEANUP_DONE_KEY)).toBeNull();
    expect(await cleanupLegacyCovers(env().value)).toBe(true);
  });

  it("works without service workers or cache storage", async () => {
    expect(await cleanupLegacyCovers({ storage: localStorage, serviceWorker: null, caches: null })).toBe(true);
  });
});
