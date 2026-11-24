import { create } from "zustand";

export const usePocketStore = create<{ open: boolean }>(() => ({ open: false }));
