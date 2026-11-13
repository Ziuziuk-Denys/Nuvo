import { coreRequest } from "@/data/core/request";

export interface RankedSong {
  id: string;
  title: string;
  artists: string;
  durationMs?: number;
  album?: boolean;
  preview?: boolean;
  plays?: number;
  verified?: boolean;
}

/** The daemon's order for a typed query, by the same relevance imports match with; of one song found twice only the better copy stays. */
export async function rankSongIds(query: string, songs: readonly RankedSong[], signal: AbortSignal): Promise<string[]> {
  const body = {
    query,
    songs: songs.map((song) => ({
      id: song.id,
      title: song.title,
      artists: [{ name: song.artists }],
      durationMs: song.durationMs ?? 0,
      ...(song.album ? { album: { title: "" } } : {}),
      ...(song.preview ? { preview: true } : {}),
      ...(song.plays !== undefined ? { plays: song.plays } : {}),
      ...(song.verified ? { verified: true } : {}),
    })),
  };
  return (await coreRequest<{ ids: string[] }>("POST", "/v1/match/rank", body, signal)).ids;
}
