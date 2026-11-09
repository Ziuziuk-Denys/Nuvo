import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { debouncedStorage } from "@/data/platform/debouncedStorage";
import { PRESET_IDS, type PresetId } from "./presets";

export const LOOK_KEY = "nuvo.look.v1";
export const LEGACY_LOOK_KEY = "nuvo_customization_v1";
export const MIN_WALLPAPER_BLUR = 10;
export const MAX_WALLPAPER_BLUR = 30;
export const MAX_WALLPAPER_DIM = 80;

export type ThemeChoice = "light" | "dark" | "system";

export interface LookFields {
  preset: PresetId;
  coverGlow: boolean;
  accentFromCover: boolean;
  backgroundImage: string | null;
  backgroundBlur: number;
  backgroundDim: number;
  themeBeforePreset: ThemeChoice | null;
}

export const LOOK_DEFAULTS: LookFields = {
  preset: "nuvo",
  coverGlow: true,
  accentFromCover: false,
  backgroundImage: null,
  backgroundBlur: 10,
  backgroundDim: 0,
  themeBeforePreset: null,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampBlur = (value: number) => clamp(value, MIN_WALLPAPER_BLUR, MAX_WALLPAPER_BLUR);
const clampDim = (value: number) => clamp(value, 0, MAX_WALLPAPER_DIM);
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
  if (PRESET_IDS.includes(state.preset as PresetId)) look.preset = state.preset as PresetId;
  if (typeof state.coverGlow === "boolean") look.coverGlow = state.coverGlow;
  if (typeof state.accentFromCover === "boolean") look.accentFromCover = state.accentFromCover;
  if (typeof state.backgroundImage === "string" && state.backgroundImage.startsWith("data:image/")) look.backgroundImage = state.backgroundImage;
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
    localStorage.setItem(LOOK_KEY, JSON.stringify({ state: migrateLegacyLook(old), version: 1 }));
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
      setThemeBeforePreset: (themeBeforePreset) => set({ themeBeforePreset }),
      resetAll: () => set({ backgroundImage: null, backgroundBlur: LOOK_DEFAULTS.backgroundBlur, backgroundDim: LOOK_DEFAULTS.backgroundDim }),
    }),
    {
      name: LOOK_KEY,
      version: 1,
      storage: createJSONStorage(() => debouncedStorage),
      partialize: ({ preset, coverGlow, accentFromCover, backgroundImage, backgroundBlur, backgroundDim, themeBeforePreset }) => ({
        preset,
        coverGlow,
        accentFromCover,
        backgroundImage,
        backgroundBlur,
        backgroundDim,
        themeBeforePreset,
      }),
      merge: (saved, current) => {
        const stored = (saved ?? {}) as Partial<LookFields>;
        return {
          ...current,
          ...stored,
          backgroundBlur: isNumber(stored.backgroundBlur) ? clampBlur(stored.backgroundBlur) : current.backgroundBlur,
          backgroundDim: isNumber(stored.backgroundDim) ? clampDim(stored.backgroundDim) : current.backgroundDim,
        };
      },
    },
  ),
);

export const selectIsGlassThemeActive = (state: Pick<LookFields, "backgroundImage">) => state.backgroundImage !== null;
export const useHasCustomBackground = () => useLookStore(selectIsGlassThemeActive);
