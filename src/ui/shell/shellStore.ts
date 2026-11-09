import { create } from "zustand";

export const useShellStore = create<{ queueOpen: boolean; setQueueOpen: (open: boolean) => void; toggleQueue: () => void }>((set) => ({
  queueOpen: false,
  setQueueOpen: (queueOpen) => set({ queueOpen }),
  toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen })),
}));
