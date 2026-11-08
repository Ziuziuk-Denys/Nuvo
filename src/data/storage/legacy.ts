import { coreRequest } from "@/data/core/request";

/** What the old renderer left in the window's storage, moved to the daemon or cleared once. */
export const LEGACY_LIMIT_KEY = "nuvo_audio_cache_limit_bytes";
export const LEGACY_CLEANUP_KEY = "nuvo.storage.legacy-cleanup";

export interface LegacyStorageEnv {
  storage: Storage | null;
  setLimit(bytes: number): Promise<void>;
  databases(): Promise<ReadonlyArray<{ name?: string }>>;
  deleteDatabase(name: string): Promise<void>;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    // nothing of Nuvo's holds it open; the browser finishes the deletion once the holder lets go
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`could not delete ${name}`));
  });
}

export function browserLegacyEnv(): LegacyStorageEnv {
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    // storage blocked: nothing to clean
  }
  return {
    storage,
    setLimit: (bytes) => coreRequest<unknown>("PATCH", "/v1/cache/settings", { limitBytes: bytes }).then(() => undefined),
    databases: async () => (typeof indexedDB === "undefined" ? [] : indexedDB.databases()),
    deleteDatabase,
  };
}

/** The user's audio cache limit goes to the daemon once; the key stays until the daemon has it. */
async function moveCacheLimit(env: LegacyStorageEnv, storage: Storage): Promise<void> {
  const raw = storage.getItem(LEGACY_LIMIT_KEY);
  if (raw === null) return;
  const bytes = Number(raw);
  if (raw.trim() === "" || !Number.isSafeInteger(bytes) || bytes < 0) {
    storage.removeItem(LEGACY_LIMIT_KEY);
    return;
  }
  try {
    await env.setLimit(bytes);
    storage.removeItem(LEGACY_LIMIT_KEY);
  } catch {
    // the daemon is down or locked: next start
  }
}

/** The old renderer's caches; Nuvo's own code keeps no IndexedDB database. */
async function dropDatabases(env: LegacyStorageEnv, storage: Storage): Promise<void> {
  if (storage.getItem(LEGACY_CLEANUP_KEY) === "1") return;
  try {
    const names = (await env.databases()).flatMap((database) => (database.name ? [database.name] : []));
    for (const name of names) await env.deleteDatabase(name);
    storage.setItem(LEGACY_CLEANUP_KEY, "1");
  } catch {
    // next start
  }
}

export async function cleanupLegacyStorage(env: LegacyStorageEnv = browserLegacyEnv()): Promise<void> {
  const storage = env.storage;
  if (!storage) return;
  await moveCacheLimit(env, storage);
  await dropDatabases(env, storage);
}
