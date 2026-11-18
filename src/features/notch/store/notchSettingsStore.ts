import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_NOTCH_SETTINGS, type NotchSettings } from "@/notch/contracts";

interface NotchSettingsState extends NotchSettings {
  setSettings: (patch: Partial<NotchSettings>) => void;
}

// v1 turns the old default "auto" off. v2 hands the single visible notch to
// the host shell, so an existing Nuvo overlay is switched off once.
export function migrateNotchSettings(persisted: unknown, version: number): Partial<NotchSettings> {
  const saved = (persisted ?? {}) as Partial<NotchSettings>;
  if (version < 1 && saved.mode === "auto") return { ...saved, mode: "off" };
  if (version < 2 && saved.mode && saved.mode !== "off") return { ...saved, mode: "off" };
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
      partialize: ({ mode, expandOn, showLyrics, pulseOnTrackChange, display, position, edge, offset, stacking }) => ({
        mode,
        expandOn,
        showLyrics,
        pulseOnTrackChange,
        display,
        position,
        edge,
        offset,
        stacking,
      }),
    },
  ),
);
