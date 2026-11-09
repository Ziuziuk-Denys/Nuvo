import { create } from "zustand";

export const useGateStore = create<{ locked: boolean }>(() => ({ locked: false }));
