export const CLEANUP_DONE_KEY = "nuvo.covers.legacy-cleanup";
const LEGACY_KEY_PREFIXES = ["nuvo:cover:", "nuvo:playlist-covers"];

export interface CleanupEnv {
  storage: Storage | null;
  serviceWorker: { getRegistrations(): Promise<ReadonlyArray<{ unregister(): Promise<boolean> }>> } | null;
  caches: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> } | null;
}

function read<T>(get: () => T | undefined): T | null {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
}

export function browserCleanupEnv(): CleanupEnv {
  return {
    storage: read(() => localStorage),
    serviceWorker: read(() => navigator.serviceWorker),
    caches: read(() => globalThis.caches),
  };
}

export async function cleanupLegacyCovers(env: CleanupEnv = browserCleanupEnv()): Promise<boolean> {
  const storage = env.storage;
  if (!storage || storage.getItem(CLEANUP_DONE_KEY) === "1") return false;
  try {
    const registrations = (await env.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = (await env.caches?.keys()) ?? [];
    await Promise.all(names.filter((name) => /cover/i.test(name)).map((name) => env.caches!.delete(name)));
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key && LEGACY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
    }
    storage.setItem(CLEANUP_DONE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
