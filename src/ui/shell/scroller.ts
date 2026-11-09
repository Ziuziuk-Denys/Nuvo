import { createContext, useContext, type RefObject } from "react";

export const ShellScrollContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });

export function useShellScroller(): RefObject<HTMLDivElement | null> {
  return useContext(ShellScrollContext);
}
