import { useSyncExternalStore } from "react";
import { offlineMode } from "@/engine/offlineMode";

export { useStreamingReachable } from "@/features/network";

export const setOfflineMode = (on: boolean): void => offlineMode.set(on);
export const useOfflineMode = (): boolean => useSyncExternalStore(offlineMode.subscribe, offlineMode.isOn);

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine);
