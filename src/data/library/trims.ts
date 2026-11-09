import { create } from "zustand";
import { coreRequest } from "@/data/core/request";
import { toSnapshot } from "@/engine/snapshot";
import type { Track } from "@/engine/types";

export interface TrackTrim {
  trackId: string;
  startMs: number;
  endMs: number;
}

export const MIN_TRIM_MS = 5000;

const enc = encodeURIComponent;

export const useTrims = create<{ byTrack: Record<string, TrackTrim> }>(() => ({ byTrack: {} }));

export async function loadTrims(): Promise<void> {
  const body = await coreRequest<{ items: TrackTrim[] }>("GET", "/v1/me/trims");
  useTrims.setState({ byTrack: Object.fromEntries(body.items.map((trim) => [trim.trackId, trim])) });
}

// The snapshot lets the daemon trim a song it has not seen
export async function saveTrim(track: Track, startMs: number, endMs: number): Promise<void> {
  const trim = await coreRequest<TrackTrim>("PUT", `/v1/tracks/${enc(track.id)}/trim`, { startMs, endMs, track: toSnapshot(track) });
  useTrims.setState((state) => ({ byTrack: { ...state.byTrack, [trim.trackId]: trim } }));
}

export async function clearTrim(trackId: string): Promise<void> {
  await coreRequest<void>("DELETE", `/v1/tracks/${enc(trackId)}/trim`);
  useTrims.setState((state) => {
    const { [trackId]: _gone, ...rest } = state.byTrack;
    return { byTrack: rest };
  });
}

// Read on every use, so a saved or cleared trim applies to the song playing now
export function trimSpan(trackId: string): TrackTrim | null {
  return useTrims.getState().byTrack[trackId] ?? null;
}
