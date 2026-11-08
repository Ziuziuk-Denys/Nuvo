import { soundBus, type SpectrumFrame, type SpectrumListener } from "@/engine";
export { useSoundStore, presetNameFor, profileGains, type Profile, type ProfileScope } from "@/features/sound/store/soundStore";
export {
  BUILT_IN_PRESETS,
  EQ_FREQUENCIES,
  EQ_MAX_DB,
  EQ_MIN_DB,
  clampGain,
  logFrequencies,
  responseDb,
  snapGain,
  type BuiltInPreset,
  type EqGains,
} from "@/features/sound/lib/eq";
export { TEMPO_PRESETS, presetOf, type TempoPresetKey } from "@/features/sound/lib/tempo";
export { applyTempo, readPlayerTempo } from "@/features/sound/useTempoSync";
export { selectArtist } from "@/features/sound/useSoundSync";
export { useAbLoopStore } from "@/features/sound/useAbLoop";
export { armSleepTimer, cancelSleepTimer, formatSleepClock, useSleepTimer } from "@/features/sound/useSleepTimer";
export type { SleepTarget } from "@/features/sound/lib/sleepTimer";

/** Live post-EQ spectrum (about 48 log bands, 0..1) and the clip light; the analyser runs only while subscribed. */
export function subscribeSpectrum(listener: SpectrumListener): () => void {
  return soundBus().subscribeSpectrum(listener);
}
export type { SpectrumFrame, SpectrumListener };
