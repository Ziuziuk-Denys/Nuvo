import type { Track } from "@/engine/types";
import type { YtTrack } from "@/youtube";
import { toEngineTrack } from "@/youtube/engine";

export type UiTrack = Track & { playCount: number };

export function toUiTrack(track: YtTrack): UiTrack {
  return { ...toEngineTrack(track), playCount: 0 };
}
