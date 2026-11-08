import { createListeners } from "./listeners";
import type { KeyValue } from "./persist";

const KEY = "nuvo.offlineMode";

/** The offline switch: while on, nothing is asked of the network and only saved, cached and local tracks play. */
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
      } catch {
        // the switch still holds for this run
      }
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
