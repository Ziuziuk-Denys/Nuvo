import type { Track } from "@/engine/types";
import { displayText } from "./messages";
import type { CatalogTrack } from "./types";

export function toPlayerTrack(track: CatalogTrack): Track {
  const artistList = track.artists.map((artist) => ({
    id: artist.id || undefined,
    name: displayText(artist.name),
  }));
  return {
    id: track.id,
    title: displayText(track.title),
    artists: artistList.map((artist) => artist.name).join(", "),
    artistList,
    coverUrl: track.cover?.url ?? "",
    durationMs: track.durationMs,
    playCount: 0,
    ...(track.explicit ? { explicit: true } : {}),
  };
}
