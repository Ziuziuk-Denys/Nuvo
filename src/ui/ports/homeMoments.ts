import { coreRequest } from "@/data/core/request";
import { libraryClient } from "@/data/library/client";
import { fromSnapshot } from "@/engine/snapshot";
import { isLocalId, type Track } from "@/engine/types";
import { cachedTrackIds } from "./catalog";
import { playSongs, songsLike } from "./homeShelves";

export interface MoodPoint {
  track: Track;
  energy: number;
  brightness: number;
  taste: number;
  fresh: boolean;
}

export interface MoodMap {
  analysed: number;
  needed: number;
  points: MoodPoint[];
}

export interface Play {
  session: string;
  track: Track;
  at: number;
  playedMs: number;
  completed: boolean;
  context: { type: string; id?: string } | null;
}

interface HistoryItem {
  listeningSessionId: string;
  track: unknown;
  playedDurationMs: number;
  completed: boolean;
  context?: { type: string; id?: string };
  listenedAt: string;
}

const HISTORY_LIMIT = 200;

export async function moodMap(): Promise<MoodMap | null> {
  try {
    const body = await coreRequest<{ analysed: number; needed: number; points: Array<Omit<MoodPoint, "track"> & { track: unknown }> }>("GET", "/v1/recs/mood");
    const points = body.points.flatMap((point) => {
      const track = fromSnapshot(point.track);
      return track ? [{ ...point, track }] : [];
    });
    return { ...body, points };
  } catch {
    return null;
  }
}

export async function plays(range?: { from: number; to: number }): Promise<Play[]> {
  try {
    const query = range ? `&from=${range.from}&to=${range.to}` : "";
    const body = await coreRequest<{ items: HistoryItem[] }>("GET", `/v1/me/history?limit=${HISTORY_LIMIT}${query}`);
    return body.items
      .flatMap((item) => {
        const track = fromSnapshot(item.track);
        if (!track) return [];
        const { listeningSessionId: session, playedDurationMs: playedMs, completed, context = null } = item;
        return [{ session, track, at: Date.parse(item.listenedAt), playedMs, completed, context }];
      })
      .sort((left, right) => left.at - right.at);
  } catch {
    return [];
  }
}

export async function kept(tracks: readonly Track[]): Promise<Set<string>> {
  const ids = [...new Set(tracks.map((track) => track.id))];
  const cached = await cachedTrackIds(ids.filter((id) => !isLocalId(id)));
  return new Set(ids.filter((id) => isLocalId(id) || cached.has(id)));
}

async function ownPlaylist(id: string): Promise<Track[]> {
  try {
    return (await libraryClient.playlist(id)).tracks;
  } catch {
    return [];
  }
}

export async function continueFrom(heard: Track[], last: { completed: boolean; playlistId: string | null }, context: string): Promise<void> {
  const list = last.playlistId ? await ownPlaylist(last.playlistId) : [];
  const step = last.completed ? 1 : 0;
  const index = list.findIndex((track) => track.id === heard[heard.length - 1].id);
  if (index >= 0 && index + step < list.length) return playSongs(list, index + step, `playlist:${last.playlistId}`);
  if (!last.completed) return playSongs(heard, heard.length - 1, context);
  const seeds = heard.map((track) => track.id);
  const next = await songsLike(context, seeds, seeds);
  const known = new Set(seeds);
  const added = next.filter((track) => !known.has(track.id));
  playSongs([...heard, ...added], added.length > 0 ? heard.length : 0, context);
}
