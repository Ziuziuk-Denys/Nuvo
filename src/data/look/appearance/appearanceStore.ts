import { create } from "zustand";
import { coreRequest } from "@/data/core/request";
import { DEFAULT_APPEARANCE, type Appearance, type AppearancePatch, type NuvoTheme } from "@/data/look/appearanceContracts";

export const CUSTOM_PREFIX = "custom:";

export interface AppearanceState {
  saved: Appearance;
  loaded: boolean;
  safe: boolean;
  draft: NuvoTheme | null;
  load(): Promise<void>;
  save(patch: AppearancePatch): Promise<boolean>;
  setDraft(theme: NuvoTheme | null): void;
  setSafe(safe: boolean): Promise<void>;
}

export const useAppearanceStore = create<AppearanceState>()((set) => ({
  saved: DEFAULT_APPEARANCE,
  loaded: false,
  safe: false,
  draft: null,

  load: async () => {
    const [saved, safe] = await Promise.all([
      coreRequest<Appearance>("GET", "/v1/appearance").catch(() => null),
      window.nuvoShell?.getMainSettings().then(
        (s) => s.appearance?.safe === true,
        () => false,
      ) ?? false,
    ]);
    set(saved ? { saved, loaded: true, safe } : { safe });
  },

  save: async (patch) => {
    try {
      set({ saved: await coreRequest<Appearance>("PATCH", "/v1/appearance", patch) });
      return true;
    } catch {
      return false;
    }
  },

  setDraft: (draft) => set({ draft }),

  setSafe: async (safe) => {
    const result = await window.nuvoShell?.setMainSetting("appearance", { safe });
    if (result?.ok !== false) set({ safe });
  },
}));

export function activeTheme(state: Pick<AppearanceState, "saved" | "safe" | "draft">): NuvoTheme | null {
  if (state.draft) return state.draft;
  const id = state.saved.active.presetId;
  if (state.safe || !id.startsWith(CUSTOM_PREFIX)) return null;
  return state.saved.themes.find((theme) => theme.id === id.slice(CUSTOM_PREFIX.length)) ?? null;
}
