import { useEffect } from "react";
import { create } from "zustand";

interface CalmState {
  count: number;
  enter: () => void;
  leave: () => void;
}

/** A counter, so overlapping screens that ask for the calm light never strand it. */
export const useCalmStore = create<CalmState>((set) => ({
  count: 0,
  enter: () => set((s) => ({ count: s.count + 1 })),
  leave: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

export function useCalmLight(): void {
  useEffect(() => {
    useCalmStore.getState().enter();
    return () => useCalmStore.getState().leave();
  }, []);
}
