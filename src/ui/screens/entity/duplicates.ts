/** The duplicate finder: one song is the same track id, or the same cleaned title by the same first artist. Pure. */
import { cleanBaseTitle } from "../../ports/matching";
import type { Track } from "../../ports/player";

// Bracketed words that only describe the upload; "(Skrillex Remix)" stays, a remix is another version.
const UPLOAD_NOTE = /[([]\s*(official[^)\]]*|lyrics?[^)\]]*|audio|video|hd|hq|4k|remaster(ed)?[^)\]]*)\s*[)\]]/gi;

/** The matcher's base title with upload notes in brackets removed first. */
export function cleanTitle(title: string): string {
  return cleanBaseTitle(title.replace(UPLOAD_NOTE, " ")).trim();
}

function firstArtist(track: Track): string {
  return (track.artistList?.[0]?.name ?? track.artists.split(",")[0] ?? "").trim().toLowerCase();
}

/** Groups of two or more in playlist order. */
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
    // a repeated track id joins the group its first copy started, whatever the title says
    const key = (track.id && byId.get(track.id)) || (title ? `${title}\u0000${firstArtist(track)}` : `id:${track.id}`);
    if (track.id && !byId.has(track.id)) byId.set(track.id, key);
    add(key, track);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Every item after the first of each group: the first one added stays. */
export function extraItemIds(groups: Track[][]): string[] {
  return groups.flatMap((group) => group.slice(1).flatMap((track) => (track.playlistItemId ? [track.playlistItemId] : [])));
}
