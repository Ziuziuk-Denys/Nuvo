import { useEffect } from "react";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { autoPreamp, resolveProfile } from "./lib/eq";
import { profileGains, useSoundStore } from "./store/soundStore";

export function selectArtist(state: { currentTrack: { artists?: string; artistList?: Array<{ name: string }> } | null }): string | null {
  const track = state.currentTrack;
  return track?.artistList?.[0]?.name ?? track?.artists?.split(",")[0]?.trim() ?? null;
}

export function useSoundSync(): void {
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const artist = usePlayerStore(selectArtist);
  const eqEnabled = useSoundStore((state) => state.eqEnabled);
  const gains = useSoundStore((state) => state.gains);
  const customPresets = useSoundStore((state) => state.customPresets);
  const byTrack = useSoundStore((state) => state.byTrack);
  const byArtist = useSoundStore((state) => state.byArtist);
  const autoGain = useSoundStore((state) => state.autoGain);
  const bypass = useSoundStore((state) => state.bypass);
  const normalization = useSoundStore((state) => state.normalization);

  useEffect(() => {
    const profile = resolveProfile(trackId, artist, byTrack, byArtist, gains);
    const resolved = profileGains(profile, customPresets);
    soundActions.setEq({
      enabled: eqEnabled,
      gains: resolved,
      preampDb: autoGain ? autoPreamp(resolved) : 0,
      bypass,
    });
  }, [trackId, artist, eqEnabled, gains, customPresets, byTrack, byArtist, autoGain, bypass]);

  // Read once per track start: a measurement landing mid-track would be an audible level step
  useEffect(() => {
    const loudness = useSoundStore.getState().loudness;
    const db = normalization === "track" && trackId ? (loudness[trackId]?.db ?? 0) : 0;
    if (trackId) soundActions.setTrackGainDb(trackId, db);
  }, [trackId, normalization]);
}
