import type { StateStorage } from "zustand/middleware";

export const DEBOUNCE_MS = 1000;

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [key, value] of pending) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
  pending.clear();
}

if (typeof window !== "undefined") window.addEventListener("beforeunload", flush);

export const debouncedStorage: StateStorage & { flush(): void } = {
  flush,
  getItem: (key) => pending.get(key) ?? localStorage.getItem(key),
  setItem: (key, value) => {
    pending.set(key, value);
    timer ??= setTimeout(flush, DEBOUNCE_MS);
  },
  removeItem: (key) => {
    pending.delete(key);
    localStorage.removeItem(key);
  },
};
