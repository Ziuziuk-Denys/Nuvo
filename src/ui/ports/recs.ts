/** Recommendations for the UI: the playing pick and its reason, "Not interested" with undo, Home mixes, playlist suggestions. */
import { catalog, player, usePlayerView } from "@/engine";
import { createContinuation } from "@/engine/adapters";
import { useEffect, useState } from "react";
import { coreRequest } from "@/data/core/request";
import { CORE_BASE_URL } from "@/engine/boot";
import type { Suggested } from "@/engine/continuation";
import {
  createRecsClient,
  skipsOnDislike,
  suggestRequest,
  type HomeMix,
  type NotInterestedResult,
  type NotInterestedScope,
  type RecsFailure,
} from "@/engine/recsClient";
import type { RankReason, Track } from "@/engine/types";
import { toEngineTrack } from "@/youtube/engine";
import { getYoutube } from "@/youtubeBoot";

export type { HomeMix, NotInterestedResult, NotInterestedScope, RecsFailure, Suppression } from "@/engine/recsClient";
export type { Suggested } from "@/engine/continuation";
export type { RankReason, Track } from "@/engine/types";

/** Always on: the engine is the only player. Kept for the UI callers that still check it. */
export const recsEnabled: boolean = true;

export const recs = createRecsClient(CORE_BASE_URL, (input, init) => fetch(input, init));

const NONE = { track: null, reason: null };

/** The playing track and why the daemon chose it (null for the user's own picks). */
export const useCurrentPick: () => { track: Track | null; reason: RankReason | null } = recsEnabled
  ? () => {
      const current = usePlayerView((view) => view.current);
      return current ? { track: current.track, reason: current.reason ?? null } : NONE;
    }
  : () => NONE;

/** Skips the track at once when the radio or continuation chose it, then records the dislike. */
export function dislike(track: Track, scope: NotInterestedScope): Promise<NotInterestedResult | RecsFailure> {
  if (recsEnabled && skipsOnDislike(player().getView(), track.id)) player().next();
  return recs.notInterested(track, scope);
}

/** Plays a Home mix from one of its tracks; its continuation context is `continue:<mixId>`. */
export function playMix(mixId: string, tracks: Track[], startAt: number): void {
  player().playList(tracks, { startAt, context: `mix:${mixId}` });
}

/** One of the daemon's Home mixes by id: undefined while it answers, null when it has no such mix today. */
export function useHomeMix(id: string | null): HomeMix | null | undefined {
  const [mix, setMix] = useState<{ id: string; mix: HomeMix | null } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let live = true;
    void recs.homeMixes().then((all) => {
      if (live) setMix({ id, mix: all.find((found) => found.id === id) ?? null });
    });
    return () => {
      live = false;
    };
  }, [id]);
  return id === null ? null : mix?.id === id ? mix.mix : undefined;
}

/** A song or an artist the user named on the first run. */
export interface FavoritePick {
  kind: "song" | "artist";
  id: string;
  title: string;
}

const STARTER_LIMIT = 15;
const TOP_TRACKS_PER_ARTIST = 3;
const SEED_TIMEOUT_MS = 15_000;

/** Fires after the starters changed, so a mounted Home asks for its mixes again. */
export const recsChanged = new EventTarget();

/** Ids of your playlists left out of recommendations: what plays from them or lands in them does not shape the taste. */
export async function excludedPlaylists(): Promise<string[]> {
  const body = await coreRequest<{ items: Array<{ kind: string; id: string }> }>("GET", "/v1/recs/excluded");
  return body.items.filter((item) => item.kind === "playlist").map((item) => item.id);
}

export async function setPlaylistExcluded(id: string, excluded: boolean): Promise<void> {
  await coreRequest<void>(excluded ? "PUT" : "DELETE", `/v1/recs/excluded/playlist/${encodeURIComponent(id)}`);
  recsChanged.dispatchEvent(new Event("change"));
}

/** The excluded ids, read again after every change; null until the daemon answered. */
export function useExcludedPlaylists(): string[] | null {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void excludedPlaylists().then(
        (next) => live && setIds(next),
        () => undefined,
      );
    read();
    recsChanged.addEventListener("change", read);
    return () => {
      live = false;
      recsChanged.removeEventListener("change", read);
    };
  }, []);
  return ids;
}

/** Sends the first-run picks as cold-start starters: each song itself, each artist's top tracks. Throws when none are saved. */
export async function seedFavorites(picks: FavoritePick[]): Promise<void> {
  const catalog = getYoutube().catalog;
  const signal = AbortSignal.timeout(SEED_TIMEOUT_MS);
  const lists = await Promise.all(
    picks.map(async (pick): Promise<Track[]> => {
      try {
        if (pick.kind === "song") return [toEngineTrack(await catalog.track(pick.id, signal))];
        const artist = await catalog.artist(pick.id, signal);
        return artist.tracks.slice(0, TOP_TRACKS_PER_ARTIST).map(toEngineTrack);
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const tracks = lists
    .flat()
    .filter((track) => !seen.has(track.id) && seen.add(track.id))
    .slice(0, STARTER_LIMIT);
  if (tracks.length === 0) throw new Error("no starters found");
  const saved = await recs.saveStarters(tracks);
  if (saved !== true) throw new Error(`starters not saved: ${saved}`);
  recsChanged.dispatchEvent(new Event("change"));
}

/**
 * Ten suggestions for a playlist: the catalog list of its newest track ranked by the daemon with the playlist
 * as seeds (the daemon adds its stored lists). Empty for an empty playlist and on any failure.
 */
export async function suggest(playlistId: string, trackIds: readonly string[]): Promise<Suggested[]> {
  if (trackIds.length === 0) return [];
  try {
    return await createContinuation(CORE_BASE_URL, catalog(), (input, init) => fetch(input, init)).next(suggestRequest(playlistId, trackIds));
  } catch {
    return [];
  }
}

/** Plays suggestions from one of them; the reason stays off the tracks, the context is `suggest:<playlistId>`. */
export function playSuggestions(playlistId: string, picks: readonly Suggested[], startAt: number): void {
  const tracks = picks.map(({ reason: _reason, ...track }) => track);
  player().playList(tracks, { startAt, context: `suggest:${playlistId}` });
}
