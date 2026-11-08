/** The app's YouTube catalog for UI data; null before the YouTube module boots. */
import type { YtCatalog } from "@/youtube";
import { getYoutube } from "@/youtubeBoot";

export function catalogSource(): YtCatalog | null {
  try {
    return getYoutube().catalog;
  } catch {
    return null;
  }
}
