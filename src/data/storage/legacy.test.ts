import { describe, expect, it, vi } from "vitest";
import { cleanupLegacyStorage, LEGACY_CLEANUP_KEY, LEGACY_LIMIT_KEY, type LegacyStorageEnv } from "./legacy";

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

function env(entries: Record<string, string> = {}, overrides: Partial<LegacyStorageEnv> = {}) {
  const storage = memoryStorage(entries);
  const deleted: string[] = [];
  const value = {
    storage,
    setLimit: vi.fn(async (_bytes: number) => undefined),
    databases: vi.fn(async () => [{ name: "old-a" }, { name: "old-b" }, {}]),
    deleteDatabase: vi.fn(async (name: string) => void deleted.push(name)),
    ...overrides,
  };
  return { env: value, storage, deleted };
}

describe("legacy renderer storage", () => {
  it("sends the old audio cache limit once and removes it after the daemon took it", async () => {
    const { env: e, storage } = env({ [LEGACY_LIMIT_KEY]: "1073741824" });
    await cleanupLegacyStorage(e);
    expect(e.setLimit).toHaveBeenCalledWith(1073741824);
    expect(storage.getItem(LEGACY_LIMIT_KEY)).toBeNull();
  });

  it("keeps the limit when the daemon refuses, and drops a value that is not a limit without a request", async () => {
    const failing = env({ [LEGACY_LIMIT_KEY]: "0" }, { setLimit: vi.fn(async () => Promise.reject(new Error("down"))) });
    await cleanupLegacyStorage(failing.env);
    expect(failing.env.setLimit).toHaveBeenCalledWith(0);
    expect(failing.storage.getItem(LEGACY_LIMIT_KEY)).toBe("0");

    const broken = env({ [LEGACY_LIMIT_KEY]: "lots" });
    await cleanupLegacyStorage(broken.env);
    expect(broken.env.setLimit).not.toHaveBeenCalled();
    expect(broken.storage.getItem(LEGACY_LIMIT_KEY)).toBeNull();
  });

  it("deletes every named IndexedDB database once", async () => {
    const { env: e, storage, deleted } = env();
    await cleanupLegacyStorage(e);
    expect(deleted).toEqual(["old-a", "old-b"]);
    expect(storage.getItem(LEGACY_CLEANUP_KEY)).toBe("1");
    await cleanupLegacyStorage(e);
    expect(e.databases).toHaveBeenCalledTimes(1);
    expect(e.setLimit).not.toHaveBeenCalled();
  });

  it("a failed deletion leaves the flag unset for the next start", async () => {
    const { env: e, storage } = env({}, { deleteDatabase: vi.fn(async () => Promise.reject(new Error("io"))) });
    await cleanupLegacyStorage(e);
    expect(storage.getItem(LEGACY_CLEANUP_KEY)).toBeNull();
  });

  it("does nothing without storage", async () => {
    const { env: e } = env();
    await expect(cleanupLegacyStorage({ ...e, storage: null })).resolves.toBeUndefined();
    expect(e.databases).not.toHaveBeenCalled();
  });
});
