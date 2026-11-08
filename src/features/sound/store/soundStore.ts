import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { debouncedStorage } from "@/data/platform/debouncedStorage";
import { TEMPO_PRESETS, type TempoSettings } from "../lib/tempo";
import { BUILT_IN_PRESETS, FLAT, clampGain, type EqGains } from "../lib/eq";

const MAX_LOUDNESS_ENTRIES = 5000;

export type Profile = string | number[];
export type ProfileScope = "track" | "artist";
export type NormalizationMode = "off" | "track";
export interface LoudnessEntry {
  db: number;
  at: number;
}
export interface Moment {
  id: string;
  positionMs: number;
  label: string;
}

export interface SoundState {
  eqEnabled: boolean;
  gains: EqGains;
  presetName: string;
  customPresets: Record<string, number[]>;
  autoGain: boolean;
  bypass: boolean;
  normalization: NormalizationMode;
  byTrack: Record<string, Profile>;
  byArtist: Record<string, Profile>;
  loudness: Record<string, LoudnessEntry>;
  moments: Record<string, Moment[]>;
  /** Tempo on tracks without memory */
  globalTempo: TempoSettings;
  tempoByTrack: Record<string, TempoSettings>;
  tempoByArtist: Record<string, TempoSettings>;

  setEnabled: (enabled: boolean) => void;
  setGain: (index: number, db: number) => void;
  setGains: (gains: EqGains) => void;
  applyPreset: (name: string) => void;
  /** Saves `gains` (the global curve when omitted); only a global save selects the new preset. */
  saveCustomPreset: (name: string, gains?: EqGains) => void;
  deleteCustomPreset: (name: string) => void;
  renameCustomPreset: (oldName: string, newName: string) => void;
  setProfile: (scope: ProfileScope, key: string, profile: Profile) => void;
  setAutoGain: (value: boolean) => void;
  setBypass: (value: boolean) => void;
  setNormalization: (mode: NormalizationMode) => void;
  rememberForTrack: (trackId: string) => void;
  rememberForArtist: (artist: string) => void;
  forget: (scope: "track" | "artist", key: string) => void;
  setLoudness: (trackId: string, db: number) => void;
  addMoment: (trackId: string, positionMs: number, label: string) => void;
  removeMoment: (trackId: string, id: string) => void;
  renameMoment: (trackId: string, id: string, label: string) => void;
  setGlobalTempo: (settings: TempoSettings) => void;
  rememberTempo: (scope: ProfileScope, key: string, settings: TempoSettings) => void;
  forgetTempo: (scope: ProfileScope, key: string) => void;
}

/** Preset name when the curve is exactly a built-in or custom preset, else the gains. */
function currentProfile(state: SoundState): Profile {
  return state.presetName !== "custom" ? state.presetName : state.gains;
}

function sameGains(a: EqGains, b: EqGains | undefined): boolean {
  return b !== undefined && a.length === b.length && a.every((db, index) => Math.abs(db - b[index]) < 1e-6);
}

/**
 * Names the preset whose curve equals `gains`, preferring `preferred`, so a curve edited back
 * to a preset reads as that preset again; "custom" when none matches.
 */
export function presetNameFor(gains: EqGains, preferred: string, customPresets: Record<string, number[]>): string {
  const presets: Array<[string, EqGains]> = [...Object.entries(BUILT_IN_PRESETS), ...Object.entries(customPresets)];
  const preferredGains = presets.find(([name]) => name === preferred)?.[1];
  if (sameGains(gains, preferredGains)) return preferred;
  return presets.find(([, preset]) => sameGains(gains, preset))?.[0] ?? "custom";
}

function profileKey(scope: ProfileScope, key: string): string {
  return scope === "artist" ? key.toLowerCase() : key;
}

/** Rewrites profiles that reference a preset by name. */
function replaceProfiles(profiles: Record<string, Profile>, name: string, next: Profile): Record<string, Profile> {
  return Object.fromEntries(Object.entries(profiles).map(([key, profile]) => [key, profile === name ? next : profile]));
}

/** Resolves a stored profile (preset name or gains) to gains; unknown names fall back to flat. */
export function profileGains(profile: Profile, customPresets: Record<string, number[]>): EqGains {
  if (Array.isArray(profile)) return profile;
  const builtIn = (BUILT_IN_PRESETS as Record<string, EqGains>)[profile];
  return builtIn ?? customPresets[profile] ?? FLAT;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      eqEnabled: false,
      gains: [...FLAT],
      presetName: "flat",
      customPresets: {},
      autoGain: true,
      bypass: false,
      normalization: "track",
      byTrack: {},
      byArtist: {},
      loudness: {},
      moments: {},
      globalTempo: TEMPO_PRESETS.normal,
      tempoByTrack: {},
      tempoByArtist: {},

      setEnabled: (eqEnabled) => set({ eqEnabled }),
      setGain: (index, db) =>
        set((state) => {
          const gains = [...state.gains];
          gains[index] = clampGain(db);
          return { gains, presetName: presetNameFor(gains, state.presetName, state.customPresets) };
        }),
      setGains: (next) =>
        set((state) => {
          const gains = next.map(clampGain);
          return { gains, presetName: presetNameFor(gains, state.presetName, state.customPresets) };
        }),
      applyPreset: (name) =>
        set((state) => {
          const gains = (BUILT_IN_PRESETS as Record<string, EqGains>)[name] ?? state.customPresets[name];
          return gains ? { gains: [...gains], presetName: name } : {};
        }),
      saveCustomPreset: (name, gains) =>
        set((state) => ({
          customPresets: { ...state.customPresets, [name]: [...(gains ?? state.gains)] },
          ...(gains ? {} : { presetName: name }),
        })),
      deleteCustomPreset: (name) =>
        set((state) => {
          const { [name]: removed, ...customPresets } = state.customPresets;
          if (!removed) return {};
          // Profiles that pointed at the preset keep its curve
          return {
            customPresets,
            presetName: state.presetName === name ? "custom" : state.presetName,
            byTrack: replaceProfiles(state.byTrack, name, [...removed]),
            byArtist: replaceProfiles(state.byArtist, name, [...removed]),
          };
        }),
      renameCustomPreset: (oldName, newName) =>
        set((state) => {
          if (!state.customPresets[oldName] || oldName === newName || state.customPresets[newName]) return {};
          const customPresets = Object.fromEntries(Object.entries(state.customPresets).map(([name, gains]) => [name === oldName ? newName : name, gains]));
          return {
            customPresets,
            presetName: state.presetName === oldName ? newName : state.presetName,
            byTrack: replaceProfiles(state.byTrack, oldName, newName),
            byArtist: replaceProfiles(state.byArtist, oldName, newName),
          };
        }),
      setProfile: (scope, key, profile) =>
        set((state) => {
          const field = scope === "track" ? "byTrack" : "byArtist";
          return { [field]: { ...state[field], [profileKey(scope, key)]: profile } };
        }),
      setAutoGain: (autoGain) => set({ autoGain }),
      setBypass: (bypass) => set({ bypass }),
      setNormalization: (normalization) => set({ normalization }),
      rememberForTrack: (trackId) => set((state) => ({ byTrack: { ...state.byTrack, [trackId]: currentProfile(state) } })),
      rememberForArtist: (artist) => set((state) => ({ byArtist: { ...state.byArtist, [artist.toLowerCase()]: currentProfile(state) } })),
      forget: (scope, key) =>
        set((state) => {
          const field = scope === "track" ? "byTrack" : "byArtist";
          const normalized = scope === "artist" ? key.toLowerCase() : key;
          const { [normalized]: _removed, ...rest } = state[field];
          return { [field]: rest };
        }),
      setLoudness: (trackId, db) =>
        set((state) => {
          const loudness = { ...state.loudness, [trackId]: { db, at: Date.now() } };
          const keys = Object.keys(loudness);
          if (keys.length > MAX_LOUDNESS_ENTRIES) {
            // Integer-like keys ignore insertion order, so evict by timestamp.
            keys.sort((a, b) => loudness[a].at - loudness[b].at);
            for (const key of keys.slice(0, keys.length - MAX_LOUDNESS_ENTRIES)) delete loudness[key];
          }
          return { loudness };
        }),
      addMoment: (trackId, positionMs, label) =>
        set((state) => ({
          moments: {
            ...state.moments,
            [trackId]: [...(state.moments[trackId] ?? []), { id: crypto.randomUUID(), positionMs, label }],
          },
        })),
      removeMoment: (trackId, id) =>
        set((state) => ({
          moments: { ...state.moments, [trackId]: (state.moments[trackId] ?? []).filter((m) => m.id !== id) },
        })),
      renameMoment: (trackId, id, label) =>
        set((state) => ({
          moments: {
            ...state.moments,
            [trackId]: (state.moments[trackId] ?? []).map((m) => (m.id === id ? { ...m, label } : m)),
          },
        })),
      setGlobalTempo: (globalTempo) => set({ globalTempo }),
      rememberTempo: (scope, key, settings) =>
        set((state) => {
          const field = scope === "track" ? "tempoByTrack" : "tempoByArtist";
          return { [field]: { ...state[field], [profileKey(scope, key)]: settings } };
        }),
      forgetTempo: (scope, key) =>
        set((state) => {
          const field = scope === "track" ? "tempoByTrack" : "tempoByArtist";
          const { [profileKey(scope, key)]: _removed, ...rest } = state[field];
          return { [field]: rest };
        }),
    }),
    {
      name: "nuvo_sound_v1",
      version: 3,
      storage: createJSONStorage(() => debouncedStorage),
      // v1 stops persisting bypass (Compare is a momentary A/B); v2 adds the tempo memory maps, v3 the global tempo
      migrate: (persisted) => {
        const { bypass: _bypass, ...rest } = (persisted ?? {}) as Record<string, unknown>;
        return { globalTempo: TEMPO_PRESETS.normal, tempoByTrack: {}, tempoByArtist: {}, ...rest } as unknown as SoundState;
      },
      partialize: (state) => ({
        eqEnabled: state.eqEnabled,
        gains: state.gains,
        presetName: state.presetName,
        customPresets: state.customPresets,
        autoGain: state.autoGain,
        normalization: state.normalization,
        byTrack: state.byTrack,
        byArtist: state.byArtist,
        loudness: state.loudness,
        moments: state.moments,
        globalTempo: state.globalTempo,
        tempoByTrack: state.tempoByTrack,
        tempoByArtist: state.tempoByArtist,
      }),
    },
  ),
);
