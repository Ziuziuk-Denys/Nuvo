import { useEffect, useState } from "react";

export type CoreStatus = "starting" | "ready" | "restarting" | "failed";

/** Daemon state reported by Electron main. Outside Electron (tests) there is nothing to wait for. */
export function useCoreStatus(): CoreStatus {
  const [status, setStatus] = useState<CoreStatus>(() => (window.nuvoElectron?.onCoreStatus ? "starting" : "ready"));

  useEffect(() => {
    const bridge = window.nuvoElectron;
    if (!bridge?.onCoreStatus) return;
    let active = true;
    void bridge.getCoreStatus().then((current) => {
      if (active) setStatus(current);
    });
    const unsubscribe = bridge.onCoreStatus(setStatus);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return status;
}
