/**
 * The YouTube client's catalog as the link features need it.
 * Only track results count for matching; a video that is gone is null.
 */
import { YtError, type SearchItem, type YtTrack } from "@/youtube/types";
import { getYoutube } from "@/youtubeBoot";
import type { YoutubeCatalog } from "./ports";
import type { CatalogTrack, MatchFilter } from "./types";

const FILTERS = { songs: "track", any: undefined, videos: "video" } as const satisfies Record<MatchFilter, unknown>;

function toCatalog(track: YtTrack): CatalogTrack {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists.map((artist) => ({ id: artist.id, name: artist.name })),
    durationMs: track.durationMs,
    ...(track.cover ? { cover: track.cover } : {}),
    ...(track.explicit ? { explicit: true as const } : {}),
  };
}

function catalog() {
  return getYoutube().catalog;
}

export const youtubeCatalog: YoutubeCatalog = {
  async searchTracks(query, filter, signal) {
    const items = await catalog().searchFiltered(query, FILTERS[filter], signal);
    return items.filter((item): item is Extract<SearchItem, { kind: "track" }> => item.kind === "track").map(toCatalog);
  },
  async track(id, signal) {
    try {
      return toCatalog(await catalog().track(id, signal));
    } catch (error) {
      if (error instanceof YtError && error.code === "not-found") return null;
      throw error;
    }
  },
};
