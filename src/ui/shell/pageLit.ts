import { usePageBackdropStore } from "../ports/backdrop";
import { useCustomizationStore } from "../ports/settings";

export function usePageLit(): boolean {
  const coverGlow = useCustomizationStore((s) => s.coverGlow);
  const pageCover = usePageBackdropStore((s) => s.coverUrl);
  return coverGlow && Boolean(pageCover);
}
