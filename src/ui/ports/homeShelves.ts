import { catalog, player } from "@/engine";
import { createContinuation } from "@/engine/adapters";
import { CORE_BASE_URL } from "@/engine/boot";
import { fromSnapshot } from "@/engine/snapshot";
import { isLocalId, type Track } from "@/engine/types";
import { coreRequest } from "@/data/core/request";
import { libraryClient } from "@/data/library/client";
import { library } from "@/data/library/library";
import type { HomeMix } from "@/engine/recsClient";
import { cachedTrackIds } from "./catalog";
import { playableLocalTracks } from "./localFiles";

/** Playlists read for one shuffle, picked at random, so a large library stays a few local reads. */
const SHUFFLE_PLAYLISTS = 10;
/** Enough ranked songs that some are left after the artist's own are dropped. */
const LIKE_CANDIDATES = 40;
const STYLE_SONGS = 40;
const GENRE_SONGS = 24;
const GENRE_WAIT_MS = 15_000;
// a genre search also finds whole compilations and hour-long mixes; only single songs belong on the shelf
const COMPILATION = /\b(hits|mix|vol\.?|volume|nonstop|playlist|compilation)\b|хит|сборник|подборк/i;
const LONGEST_SONG_MS = 9 * 60_000;
// a big library stays a few hundred local cache reads
const OFFLINE_PROBES = 400;
const OFFLINE_MIX_MIN = 4;

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

export async function genreSongs(query: string): Promise<Track[]> {
  try {
    const found = await catalog().searchFiltered(query, "songs", AbortSignal.timeout(GENRE_WAIT_MS));
    return found
      .filter((track) => !COMPILATION.test(`${track.title} ${track.artists}`) && track.durationMs < LONGEST_SONG_MS)
      .slice(0, GENRE_SONGS);
  } catch {
    return [];
  }
}

export async function offlineSongs(): Promise<Track[]> {
  const [saved, local] = await Promise.all([librarySongs(), playableLocalTracks()]);
  const probed = shuffled(saved.filter((track) => !isLocalId(track.id))).slice(0, OFFLINE_PROBES);
  const cached = await cachedTrackIds(probed.map((track) => track.id));
  return [...local, ...probed.filter((track) => cached.has(track.id))];
}

export async function offlineMixes(mixes: readonly HomeMix[]): Promise<HomeMix[]> {
  const ids = [...new Set(mixes.flatMap((mix) => mix.tracks.map((track) => track.id)))].filter((id) => !isLocalId(id));
  const cached = await cachedTrackIds(ids.slice(0, OFFLINE_PROBES));
  return mixes
    .map((mix) => ({ ...mix, tracks: mix.tracks.filter((track) => isLocalId(track.id) || cached.has(track.id)) }))
    .filter((mix) => mix.tracks.length >= OFFLINE_MIX_MIN);
}
