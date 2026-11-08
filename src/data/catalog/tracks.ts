/** A catalog track as the UI's lists take it: the library snapshot plus a play count (none yet for catalog tracks). */
import type { Track } from "@/engine/types";
import type { YtTrack } from "@/youtube";
import { toEngineTrack } from "@/youtube/engine";

export type UiTrack = Track & { playCount: number };

export function toUiTrack(track: YtTrack): UiTrack {
  return { ...toEngineTrack(track), playCount: 0 };
}
