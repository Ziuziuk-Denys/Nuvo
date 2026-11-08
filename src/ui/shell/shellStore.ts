import { create } from "zustand";

/** Shell state shared by the island, the queue panel and the global shortcuts. */
export const useShellStore = create<{ queueOpen: boolean; setQueueOpen: (open: boolean) => void; toggleQueue: () => void }>((set) => ({
  queueOpen: false,
  setQueueOpen: (queueOpen) => set({ queueOpen }),
  toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen })),
}));
