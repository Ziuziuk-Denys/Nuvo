export {
  useLookStore as useCustomizationStore,
  MIN_WALLPAPER_BLUR,
  MAX_WALLPAPER_BLUR,
  MAX_WALLPAPER_DIM,
  wallpaperKind,
  WALLPAPER_BASE,
  type WallpaperFit,
  type WallpaperKind,
} from "@/data/look/lookStore";
export { useAppVersion } from "@/data/platform/version";
export { notesFor, takeWhatsNew } from "@/data/platform/releaseNotes";
import { shippedLocales } from "@/i18n";

export type { Locale } from "@/i18n";
export const LOCALE_OPTIONS = shippedLocales.map(({ code, name }) => ({ value: code, label: name, icon: undefined }));
export const PRIMARY_LOCALES = shippedLocales.map(({ code }) => code);
