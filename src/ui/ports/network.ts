import { useSyncExternalStore } from "react";
import { offlineMode } from "@/engine/offlineMode";

export { useStreamingReachable } from "@/features/network";

/** The offline switch: on means only saved, cached and local tracks play. */
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

/** Whether the machine has a network at all, whichever services that network blocks. */
export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine);
