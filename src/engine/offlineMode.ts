import { createListeners } from "./listeners";
import type { KeyValue } from "./persist";

const KEY = "nuvo.offlineMode";

export function createOfflineMode(storage: KeyValue) {
  let on = storage.getItem(KEY) === "1";
  const listeners = createListeners();
  return {
    isOn: () => on,
    set(next: boolean): void {
      if (next === on) return;
      on = next;
      try {
        storage.setItem(KEY, next ? "1" : "0");
      } catch {}
      listeners.emit();
    },
    subscribe: listeners.subscribe,
  };
}

function browserStorage(): KeyValue {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
}

export const offlineMode = createOfflineMode(browserStorage());
