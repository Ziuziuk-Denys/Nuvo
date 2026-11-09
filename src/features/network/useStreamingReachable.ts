import { useEffect, useState } from "react";
import { probeStreamingHosts } from "./probe";

const RECHECK_MS = 60_000;

export function useStreamingReachable(): boolean {
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let active = true;
    const check = () => {
      void probeStreamingHosts().then((ok) => {
        if (active) setReachable(ok);
      });
    };
    check();
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    const timer = reachable ? null : setInterval(check, RECHECK_MS);
    return () => {
      active = false;
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
      if (timer) clearInterval(timer);
    };
  }, [reachable]);

  return reachable;
}
