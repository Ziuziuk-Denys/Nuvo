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
export { isSoundCloudId } from "@/engine/types";

export function currentStreamFormat(): { codec: string; bitrate: number } | null {
  return playerRuntime?.currentStreamFormat() ?? null;
}

export function currentFallback(): { source: string; restarted: boolean; hover: string } | null {
  return playerRuntime?.currentFallback() ?? null;
}

export const keepVersion = (): Promise<boolean> => playerRuntime?.keepVersion() ?? Promise.resolve(false);

export const rejectVersion = (trackId: string): Promise<void> => playerRuntime?.rejectVersion(trackId) ?? Promise.resolve();

export { CROSSFADE_MAX_S } from "@/engine/audio/transitionPolicy";
export type { OutputDevice } from "@/engine/types";

export async function chosenSource(trackId: string): Promise<{ source: string; altId: string; reason: string } | null> {
  const answer = await coreRequest<{ source: string; altId: string; reason: string } | undefined>(
    "GET",
    `/v1/tracks/${encodeURIComponent(trackId)}/alternative`,
  );
  return answer ?? null;
}

export function chooseSource(trackId: string, version: { id: string; durationMs: number } | null): Promise<void> {
  return choose(trackId, version ? { source: "youtube", altId: version.id, score: 100, durationMs: version.durationMs || undefined } : null);
}
