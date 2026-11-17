import { useEffect } from "react";
import { playerEngine, usePlayerStore } from "../../ports/player";

export function useHoldTrack(): void {
  useEffect(() => {
    const before = usePlayerStore.getState().repeat;
    if (before !== "one") playerEngine.setRepeat("one");
    return () => {
      if (before !== "one" && usePlayerStore.getState().repeat === "one") playerEngine.setRepeat(before);
    };
  }, []);
}
