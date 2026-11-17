import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setStudioOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStudioOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
