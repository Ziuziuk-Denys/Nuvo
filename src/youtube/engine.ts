import type { CatalogPort } from "../engine/adapters";
import type { YoutubePort } from "../engine/sources/ports";
import type { Track } from "../engine/types";
import type { Youtube } from "./index";
import type { SearchItem, YtTrack } from "./types";

export function toEngineTrack(track: YtTrack): Track {
  const first = track.artists[0];
  return {
    id: track.id,
    title: track.title,
    artists: track.artists.map((artist) => artist.name).join(", "),
    artistId: first && first.id && first.id !== "unknown" ? first.id : undefined,
    artistList: track.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
    })),
    album: track.album,
    coverUrl: track.cover?.url ?? "",
    durationMs: track.durationMs,
    explicit: track.explicit,
  };
}

const tracksOnly = (items: SearchItem[]) => items.filter((item): item is Extract<SearchItem, { kind: "track" }> => item.kind === "track");

export function engineYoutube(youtube: Pick<Youtube, "playback">): YoutubePort {
  return {
    resolve: (track, options, signal) =>
      youtube.playback.resolve(
        track,
        {
          progressive: options.progressive,
          early: options.early,
          quality: options.quality,
          codec: options.codec === "opus" || options.codec === "aac" ? options.codec : undefined,
        },
        signal,
      ),
    fetchWhole: (source, signal) => youtube.playback.fetchWhole(source, signal),
    warmUp: () => youtube.playback.warmUp(),
  };
}

export function engineCatalog(youtube: Pick<Youtube, "catalog">): CatalogPort {
  return {
    async searchFiltered(query, filter, signal) {
      const items = await youtube.catalog.searchFiltered(query, filter === "songs" ? "track" : filter === "videos" ? "video" : undefined, signal);
      return tracksOnly(items).map(toEngineTrack);
    },
    async radio(id, options, signal) {
      return (await youtube.catalog.radio(id, { limit: options.limit }, signal)).map(toEngineTrack);
    },
  };
}
