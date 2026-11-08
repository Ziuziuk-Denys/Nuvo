import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_NOTCH_SETTINGS, type NotchSettings } from "@/notch/contracts";

interface NotchSettingsState extends NotchSettings {
  setSettings: (patch: Partial<NotchSettings>) => void;
}

export const useNotchSettingsStore = create<NotchSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_NOTCH_SETTINGS,
      setSettings: (patch) => set(patch),
    }),
    {
      name: "nuvo_notch_settings_v1",
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
