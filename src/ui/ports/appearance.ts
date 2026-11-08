/** Fonts, the theme editor and custom CSS (customization design) for the Appearance and Customization sections. */
export { useAppearanceStore, activeTheme, CUSTOM_PREFIX } from "@/data/look/appearance/appearanceStore";
export {
  normalizeColour,
  parseThemeFile,
  rolesFor,
  serializeTheme,
  ROLE_KEYS,
  type NuvoTheme,
  type RoleKey,
  type ThemeRoles,
} from "@/data/look/appearance/themeSchema";
export { blockingModes, contrastReport, deriveRoles, fixContrast, themeFromPreset, themeTokens, type ContrastLine } from "@/data/look/appearance/deriveTheme";
export { sanitizeCss, CSS_LIMITS, type CssProblem } from "@/data/look/appearance/cssSanitizer";
export { applyFontSettings, cssFamily, dropUserFonts, familyValue, loadUserFont, userFontFamily } from "@/data/look/appearance/applyAppearance";
export { removeCustomCss, watchCustomCss } from "@/data/look/appearance/customCss";
export { applyTokens } from "@/data/look/apply";
export {
  DEFAULT_APPEARANCE,
  DEFAULT_FONTS,
  type Appearance,
  type AppearancePatch,
  type FontChoice,
  type FontFileEntry,
  type FontSettings,
} from "@/data/look/appearanceContracts";
export { parseColor, toHex } from "@/data/color/contrast";
export { hslToRgb, rgbToHsl } from "@/data/color/hsl";
