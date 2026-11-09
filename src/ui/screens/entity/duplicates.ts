import { cleanBaseTitle } from "../../ports/matching";
import type { Track } from "../../ports/player";

// Bracketed upload notes only; "(Skrillex Remix)" stays, a remix is another version
const UPLOAD_NOTE = /[([]\s*(official[^)\]]*|lyrics?[^)\]]*|audio|video|hd|hq|4k|remaster(ed)?[^)\]]*)\s*[)\]]/gi;

export function cleanTitle(title: string): string {
  return cleanBaseTitle(title.replace(UPLOAD_NOTE, " ")).trim();
}

function firstArtist(track: Track): string {
  return (track.artistList?.[0]?.name ?? track.artists.split(",")[0] ?? "").trim().toLowerCase();
}

export function duplicateGroups(tracks: readonly Track[]): Track[][] {
  const groups = new Map<string, Track[]>();
  const add = (key: string, track: Track) => {
    const group = groups.get(key);
    if (group) group.push(track);
    else groups.set(key, [track]);
  };
  const byId = new Map<string, string>();
  for (const track of tracks) {
    const title = cleanTitle(track.title);
    const key = (track.id && byId.get(track.id)) || (title ? `${title}\u0000${firstArtist(track)}` : `id:${track.id}`);
    if (track.id && !byId.has(track.id)) byId.set(track.id, key);
    add(key, track);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function extraItemIds(groups: Track[][]): string[] {
  return groups.flatMap((group) => group.slice(1).flatMap((track) => (track.playlistItemId ? [track.playlistItemId] : [])));
}
