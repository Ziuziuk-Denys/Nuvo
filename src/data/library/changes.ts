import { createListeners } from "@/engine/listeners";

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

export function dropLegacyLibraryKeys(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(LEGACY_COVERS_KEY);
  } catch {}
}
