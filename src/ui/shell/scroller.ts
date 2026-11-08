import { createContext, useContext, type RefObject } from "react";

/** The shell's one scrolling content column, for virtual lists that scroll with the page. */
export const ShellScrollContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });

export function useShellScroller(): RefObject<HTMLDivElement | null> {
  return useContext(ShellScrollContext);
}
