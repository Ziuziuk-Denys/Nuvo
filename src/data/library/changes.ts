import { createListeners } from "@/engine/listeners";

/** Library change notices: this client's own writes, and the daemon's unlock (CoreGate dispatches `library:changed`). */
export const LEGACY_COVERS_KEY = "nuvo:playlist-covers-v2";

const listeners = createListeners();
let windowHooked = false;

export function notifyLibraryChanged(): void {
  listeners.emit();
}

export function onLibraryChange(listener: () => void): () => void {
  if (!windowHooked && typeof window !== "undefined") {
    windowHooked = true;
    window.addEventListener("library:changed", notifyLibraryChanged);
  }
  return listeners.subscribe(listener);
}

/** The old renderer cover cache holds no user data. */
export function dropLegacyLibraryKeys(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(LEGACY_COVERS_KEY);
  } catch {
    // storage blocked: nothing to clean
  }
}
