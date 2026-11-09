import { catalog, player } from "@/engine";
import { createContinuation } from "@/engine/adapters";
import { CORE_BASE_URL } from "@/engine/boot";
import { fromSnapshot } from "@/engine/snapshot";
import type { Track } from "@/engine/types";
import { coreRequest } from "@/data/core/request";
import { libraryClient } from "@/data/library/client";
import { library } from "@/data/library/library";

/** Playlists read for one shuffle, picked at random, so a large library stays a few local reads. */
const SHUFFLE_PLAYLISTS = 10;
/** Enough ranked songs that some are left after the artist's own are dropped. */
const LIKE_CANDIDATES = 40;
const STYLE_SONGS = 40;

export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

export async function librarySongs(): Promise<Track[]> {
  try {
    const playlists = shuffled(await libraryClient.playlists()).slice(0, SHUFFLE_PLAYLISTS);
    const lists = await Promise.all([library().liked.allTracks(), ...playlists.map(async (playlist) => (await libraryClient.playlist(playlist.id)).tracks)]);
    const seen = new Set<string>();
    return lists.flat().filter((track) => track.id !== "" && !seen.has(track.id) && seen.add(track.id));
  } catch {
    return [];
  }
}

export async function songsLike(context: string, seeds: readonly string[], shown: readonly string[]): Promise<Track[]> {
  try {
    const picks = await createContinuation(CORE_BASE_URL, catalog(), (input, init) => fetch(input, init)).next({
      context,
      seeds: [...seeds],
      recent: [...seeds, ...shown],
      sessionId: null,
      limit: LIKE_CANDIDATES,
    });
    return picks.map(({ reason: _reason, ...track }) => track);
  } catch {
    return [];
  }
}

export async function localStyle(): Promise<{ genre: string; tracks: Track[] } | null> {
  try {
    const body = await coreRequest<{ genre: string | null; items: unknown[] }>("GET", `/v1/local/style?limit=${STYLE_SONGS}`);
    if (!body.genre) return null;
    return { genre: body.genre, tracks: body.items.map(fromSnapshot).filter((track): track is Track => track !== null) };
  } catch {
    return null;
  }
}

export function playSongs(tracks: Track[], startAt: number, context: string): void {
  player().playList(tracks, { startAt, context });
}
