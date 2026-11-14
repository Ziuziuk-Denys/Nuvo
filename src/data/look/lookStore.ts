import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { debouncedStorage } from "@/data/platform/debouncedStorage";
import { PRESET_IDS, type PresetId } from "./presets";

export const LOOK_KEY = "nuvo.look.v1";
export const LEGACY_LOOK_KEY = "nuvo_customization_v1";
export const LOOK_VERSION = 2;
export const MIN_WALLPAPER_BLUR = 0;
export const MAX_WALLPAPER_BLUR = 30;
export const MAX_WALLPAPER_DIM = 80;

export type ThemeChoice = "light" | "dark" | "system";
export type WallpaperFit = "cover" | "contain";
export const WALLPAPER_BASE = "nuvo-core://local/wallpaper/";

export interface LookFields {
  preset: PresetId;
  coverGlow: boolean;
  accentFromCover: boolean;
  backgroundImage: string | null;
  backgroundBlur: number;
  backgroundDim: number;
  backgroundFit: WallpaperFit;
  themeBeforePreset: ThemeChoice | null;
}

export const LOOK_DEFAULTS: LookFields = {
  preset: "nuvo",
  coverGlow: true,
  accentFromCover: false,
  backgroundImage: null,
  backgroundBlur: 10,
  backgroundDim: 25,
  backgroundFit: "cover",
  themeBeforePreset: null,
};

export const RETIRED_PRESETS: Record<string, PresetId> = {
  editor: "ink",
  orbit: "frost",
  vinyl: "amber",
  cosmos: "velvet",
  sunset: "dusk",
  amethyst: "velvet",
  y2k: "blossom",
  cassette: "amber",
  marshmallow: "blossom",
  indigo: "nuvo",
};

export function migratePresetId(id: unknown): PresetId | null {
  if (PRESET_IDS.includes(id as PresetId)) return id as PresetId;
  return typeof id === "string" && Object.hasOwn(RETIRED_PRESETS, id) ? RETIRED_PRESETS[id] : null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampBlur = (value: number) => clamp(value, MIN_WALLPAPER_BLUR, MAX_WALLPAPER_BLUR);
const clampDim = (value: number) => clamp(value, 0, MAX_WALLPAPER_DIM);
// A copy main stored, or a picture older versions saved inline
const isWallpaper = (value: unknown): value is string =>
  typeof value === "string" && (/^nuvo-core:\/\/local\/wallpaper\/[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(value) || value.startsWith("data:image/"));
export type WallpaperKind = "photo" | "gif" | "video";
export function wallpaperKind(url: string): WallpaperKind {
  if (/\.(mp4|webm)$/.test(url)) return "video";
  return url.endsWith(".gif") || url.startsWith("data:image/gif") ? "gif" : "photo";
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function migrateLegacyLook(raw: string | null): LookFields {
  let state: Record<string, unknown> = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as { state?: Record<string, unknown> } | null) : null;
    state = parsed?.state ?? {};
  } catch {
    return { ...LOOK_DEFAULTS };
  }
  const look = { ...LOOK_DEFAULTS };
  look.preset = migratePresetId(state.preset) ?? look.preset;
  if (typeof state.coverGlow === "boolean") look.coverGlow = state.coverGlow;
  if (typeof state.accentFromCover === "boolean") look.accentFromCover = state.accentFromCover;
  if (isWallpaper(state.backgroundImage)) look.backgroundImage = state.backgroundImage;
  if (isNumber(state.backgroundBlur)) look.backgroundBlur = clampBlur(state.backgroundBlur);
  if (isNumber(state.backgroundDim)) look.backgroundDim = clampDim(state.backgroundDim);
  if (state.themeBeforePreset === "light" || state.themeBeforePreset === "dark" || state.themeBeforePreset === "system")
    look.themeBeforePreset = state.themeBeforePreset;
  return look;
}

function moveLegacy(): void {
  try {
    if (localStorage.getItem(LOOK_KEY) !== null) return;
    const old = localStorage.getItem(LEGACY_LOOK_KEY);
    if (old === null) return;
    localStorage.setItem(LOOK_KEY, JSON.stringify({ state: migrateLegacyLook(old), version: LOOK_VERSION }));
    localStorage.removeItem(LEGACY_LOOK_KEY);
  } catch {}
}

interface LookState extends LookFields {
  setPreset(preset: PresetId): void;
  setCoverGlow(on: boolean): void;
  setAccentFromCover(on: boolean): void;
  setBackgroundImage(image: string | null): void;
  setBackgroundBlur(blur: number): void;
  setBackgroundDim(dim: number): void;
  setBackgroundFit(fit: WallpaperFit): void;
  setThemeBeforePreset(theme: ThemeChoice | null): void;
  resetAll(): void;
}

moveLegacy();

export const useLookStore = create<LookState>()(
  persist(
    (set) => ({
      ...LOOK_DEFAULTS,
      setPreset: (preset) => set({ preset }),
      setCoverGlow: (coverGlow) => set({ coverGlow }),
      setAccentFromCover: (accentFromCover) => set({ accentFromCover }),
      setBackgroundImage: (backgroundImage) => set({ backgroundImage }),
      setBackgroundBlur: (blur) => set({ backgroundBlur: clampBlur(blur) }),
      setBackgroundDim: (dim) => set({ backgroundDim: clampDim(dim) }),
      setBackgroundFit: (backgroundFit) => set({ backgroundFit }),
      setThemeBeforePreset: (themeBeforePreset) => set({ themeBeforePreset }),
      resetAll: () =>
        set({
          backgroundImage: null,
          backgroundBlur: LOOK_DEFAULTS.backgroundBlur,
          backgroundDim: LOOK_DEFAULTS.backgroundDim,
          backgroundFit: LOOK_DEFAULTS.backgroundFit,
        }),
    }),
    {
      name: LOOK_KEY,
      version: LOOK_VERSION,
      migrate: (saved) => {
        const state = (saved ?? {}) as Partial<LookFields>;
        return { ...state, preset: migratePresetId(state.preset) ?? LOOK_DEFAULTS.preset } as LookFields;
      },
      storage: createJSONStorage(() => debouncedStorage),
      partialize: ({ preset, coverGlow, accentFromCover, backgroundImage, backgroundBlur, backgroundDim, backgroundFit, themeBeforePreset }) => ({
        preset,
        coverGlow,
        accentFromCover,
        backgroundImage,
        backgroundBlur,
        backgroundDim,
        backgroundFit,
        themeBeforePreset,
      }),
      merge: (saved, current) => {
        const stored = (saved ?? {}) as Partial<LookFields>;
        return {
          ...current,
          ...stored,
          preset: migratePresetId(stored.preset) ?? current.preset,
          backgroundBlur: isNumber(stored.backgroundBlur) ? clampBlur(stored.backgroundBlur) : current.backgroundBlur,
          backgroundDim: isNumber(stored.backgroundDim) ? clampDim(stored.backgroundDim) : current.backgroundDim,
          backgroundImage: isWallpaper(stored.backgroundImage) ? stored.backgroundImage : null,
          backgroundFit: stored.backgroundFit === "contain" ? "contain" : "cover",
        };
      },
    },
  ),
);

// main drops the old copy on replace; removal and reset need this
useLookStore.subscribe((state, previous) => {
  if (state.backgroundImage === null && previous.backgroundImage?.startsWith(WALLPAPER_BASE)) void window.nuvoShell?.clearWallpaper();
});
