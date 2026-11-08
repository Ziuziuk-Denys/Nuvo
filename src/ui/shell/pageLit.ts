import { usePageBackdropStore } from "../ports/backdrop";
import { useCustomizationStore } from "../ports/settings";

/** True while a page cover lights the window: the player turns to glass and the page runs on under it. */
export function usePageLit(): boolean {
  const coverGlow = useCustomizationStore((s) => s.coverGlow);
  const pageCover = usePageBackdropStore((s) => s.coverUrl);
  return coverGlow && Boolean(pageCover);
}
