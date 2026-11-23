import { useSyncExternalStore } from "react";

export const CONTROLS_MODES = ["fade", "always"] as const;
export type ControlsMode = (typeof CONTROLS_MODES)[number];

const KEY = "nuvo.karaoke.controls";

function read(): ControlsMode {
  try {
    return localStorage.getItem(KEY) === "always" ? "always" : "fade";
  } catch {
    return "fade";
  }
}

let mode = read();
const listeners = new Set<() => void>();

export function setControlsMode(next: ControlsMode): void {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useControlsMode(): ControlsMode {
  return useSyncExternalStore(subscribe, () => mode);
}
