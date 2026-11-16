import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_NOTCH_SETTINGS, type NotchSettings } from "@/notch/contracts";

interface NotchSettingsState extends NotchSettings {
  setSettings: (patch: Partial<NotchSettings>) => void;
}

export function migrateNotchSettings(persisted: unknown, _version: number): Partial<NotchSettings> {
  const saved = (persisted ?? {}) as Partial<NotchSettings>;
  if (_version < 2 && saved.mode === "off") return { ...saved, mode: "auto" };
  return saved;
}

export const useNotchSettingsStore = create<NotchSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_NOTCH_SETTINGS,
      setSettings: (patch) => set(patch),
    }),
    {
      name: "nuvo_notch_settings_v1",
      version: 2,
      migrate: (persisted, version) => migrateNotchSettings(persisted, version) as NotchSettingsState,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ mode, expandOn, showLyrics, pulseOnTrackChange, display }) => ({
        mode,
        expandOn,
        showLyrics,
        pulseOnTrackChange,
        display,
      }),
    },
  ),
);
