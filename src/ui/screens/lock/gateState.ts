import { create } from "zustand";

/** Whether the library is locked; the shell hides the player while it is, since the encrypted cache is locked too. */
export const useGateStore = create<{ locked: boolean }>(() => ({ locked: false }));
