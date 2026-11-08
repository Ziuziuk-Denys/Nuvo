import { useEffect } from "react";
import type { Track } from "@/engine/types";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { selectArtist } from "./useSoundSync";
import { sameTempo, TEMPO_PRESETS, type TempoSettings } from "./lib/tempo";
import { useSoundStore, type ProfileScope } from "./store/soundStore";

export function readPlayerTempo(): TempoSettings {
  const player = usePlayerStore.getState();
  return {
    rate: player.playbackRate,
    pitchSemitones: player.pitchSemitones,
    pitchLinked: player.isPitchLinked,
    reverb: player.isReverbEnabled ? player.reverbLevel : null,
  };
}

/** Applies settings through the engine so its ramps run. */
export function applyTempo(settings: TempoSettings): void {
  soundActions.setTempo(settings);
}

/** What a track will play at: its memory, its artist's memory, else the global or neutral tempo. */
export function tempoFor(track: Track): TempoSettings {
  const sound = useSoundStore.getState();
  const artist = selectArtist({ currentTrack: track });
  const memory = activeTempoScope(track.id, artist, sound.tempoByTrack, sound.tempoByArtist);
  if (memory) return memory.settings;
  return usePlayerStore.getState().keepSpeedAcrossTracks ? sound.globalTempo : TEMPO_PRESETS.normal;
}

/** Track memory beats artist memory; null when neither exists. */
export function activeTempoScope(
  trackId: string | null,
  artist: string | null,
  byTrack: Record<string, TempoSettings>,
  byArtist: Record<string, TempoSettings>,
): { scope: ProfileScope; key: string; settings: TempoSettings } | null {
  if (trackId && byTrack[trackId]) return { scope: "track", key: trackId, settings: byTrack[trackId] };
  const artistKey = artist?.toLowerCase();
  if (artistKey && byArtist[artistKey]) return { scope: "artist", key: artistKey, settings: byArtist[artistKey] };
  return null;
}

function currentScope() {
  const sound = useSoundStore.getState();
  const player = usePlayerStore.getState();
  return activeTempoScope(player.currentTrack?.id ?? null, selectArtist(player), sound.tempoByTrack, sound.tempoByArtist);
}

// Single owner of tempo on track change: the runtime no longer resets speed itself
export function useTempoSync(): void {
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const artist = usePlayerStore(selectArtist);
  const tempoByTrack = useSoundStore((state) => state.tempoByTrack);
  const tempoByArtist = useSoundStore((state) => state.tempoByArtist);
  const rate = usePlayerStore((state) => state.playbackRate);
  const pitch = usePlayerStore((state) => state.pitchSemitones);
  const linked = usePlayerStore((state) => state.isPitchLinked);
  const reverbOn = usePlayerStore((state) => state.isReverbEnabled);
  const reverbLevel = usePlayerStore((state) => state.reverbLevel);

  // The engine asks this for every start and for the prepared next deck, so a transition never jumps.
  useEffect(() => {
    soundActions.setTempoResolver(tempoFor);
    return () => soundActions.setTempoResolver(null);
  }, []);

  const active = activeTempoScope(trackId, artist, tempoByTrack, tempoByArtist);
  const activeId = active ? `${active.scope}:${active.key}` : null;

  // Apply on track change or when the governing memory changes (declared first: it runs before capture)
  useEffect(() => {
    let target: TempoSettings | null = currentScope()?.settings ?? null;
    if (!target && trackId !== null) {
      target = usePlayerStore.getState().keepSpeedAcrossTracks ? useSoundStore.getState().globalTempo : TEMPO_PRESETS.normal;
    }
    // Re-applying the playing tempo would still unlink and relink the pitch for nothing
    if (target && !sameTempo(readPlayerTempo(), target)) applyTempo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state is read fresh; only the track and the governing memory matter
  }, [trackId, artist, activeId]);

  // Capture edits: into the governing memory, or into the stored global tempo
  useEffect(() => {
    const current = currentScope();
    const live = readPlayerTempo();
    const sound = useSoundStore.getState();
    if (!current) {
      if (!sameTempo(live, sound.globalTempo)) sound.setGlobalTempo(live);
    } else if (!sameTempo(live, current.settings)) {
      sound.rememberTempo(current.scope, current.key, live);
    }
  }, [rate, pitch, linked, reverbOn, reverbLevel]);
}
