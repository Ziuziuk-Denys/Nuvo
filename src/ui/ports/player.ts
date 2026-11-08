import { coreRequest } from "@/data/core/request";
import { playerRuntime } from "@/engine/compat";
import { chooseSource as choose } from "@/engine/index";

export {
  usePlayerState,
  playerEngine,
  playerOutputs,
  usePlayerStore,
  isRadioContext,
  nextRepeatMode,
  toVolumeGain,
  toVolumeLevel,
  type RepeatMode,
} from "@/engine/compat";
export type { Track } from "@/engine/types";

/** Codec and bit rate (bit/s) of the stream playing now; null for a cached file. */
export function currentStreamFormat(): { codec: string; bitrate: number } | null {
  return playerRuntime?.currentStreamFormat() ?? null;
}

/** Set while another source stands in for the track. */
export function currentFallback(): { source: string; restarted: boolean; hover: string } | null {
  return playerRuntime?.currentFallback() ?? null;
}

/** Keeps the stand-in that plays for this track. */
export const keepVersion = (): Promise<boolean> => playerRuntime?.keepVersion() ?? Promise.resolve(false);

/** Never offers this stand-in for the track again. */
export const rejectVersion = (trackId: string): Promise<void> => playerRuntime?.rejectVersion(trackId) ?? Promise.resolve();

export { CROSSFADE_MAX_S } from "@/engine/audio/transitionPolicy";
export type { OutputDevice } from "@/engine/types";

/** The version a track plays from instead of its own source, when one was chosen or kept; null for the original. */
export async function chosenSource(trackId: string): Promise<{ source: string; altId: string; reason: string } | null> {
  const answer = await coreRequest<{ source: string; altId: string; reason: string } | undefined>(
    "GET",
    `/v1/tracks/${encodeURIComponent(trackId)}/alternative`,
  );
  return answer ?? null;
}

/** Plays the track from this YouTube version from now on, or from its original source again with null. */
export function chooseSource(trackId: string, version: { id: string; durationMs: number } | null): Promise<void> {
  return choose(trackId, version ? { source: "youtube", altId: version.id, score: 100, durationMs: version.durationMs || undefined } : null);
}
