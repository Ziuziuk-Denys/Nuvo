// Shapes of `GET` and `PATCH /v1/appearance` (nuvo-contracts appearance.rs, customization design 3).
import type { FontFileEntry } from "@/shell/nuvoShell";

export type { FontFileEntry };

/** The nine colour roles in theme-file order; `--n-<role>`, with ink2 and ink3 written as ink-2 and ink-3. */
export const ROLE_KEYS = ["field", "deep", "raised", "ink", "ink2", "ink3", "hair", "tint", "accent"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export type ThemeRoles = Record<RoleKey, string>;
export type ThemeMode = "light" | "dark";

export interface NuvoTheme {
  format: "nuvo-theme";
  version: 1;
  id: string;
  name: string;
  author?: string;
  modes: Partial<Record<ThemeMode, ThemeRoles>>;
  defaultMode: ThemeMode;
  /** Only in files: CSS a shared theme carries. A stored theme never has it; import moves it to custom CSS after asking. */
  css?: string;
}

export type FontChoice = { kind: "default" } | { kind: "system"; family: string } | { kind: "file"; id: string };

export interface FontSettings {
  ui: FontChoice;
  lyrics: FontChoice;
  uiScale: number;
  lyricsScale: number;
}

export interface Appearance {
  themes: NuvoTheme[];
  /** A built-in preset id or `custom:<themeId>`. */
  active: { presetId: string };
  fonts: FontSettings;
  fontFiles: FontFileEntry[];
  customCss: { enabled: boolean; text: string };
}

export type AppearancePatch = Partial<Appearance>;

export const DEFAULT_FONTS: FontSettings = { ui: { kind: "default" }, lyrics: { kind: "default" }, uiScale: 1, lyricsScale: 1 };

export const DEFAULT_APPEARANCE: Appearance = {
  themes: [],
  active: { presetId: "nuvo" },
  fonts: DEFAULT_FONTS,
  fontFiles: [],
  customCss: { enabled: false, text: "" },
};
