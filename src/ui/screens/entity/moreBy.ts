import type { ArtistReleaseViewModel } from "../../ports/catalog";
import type { LibraryItemViewModel } from "../../ports/library";
import type { Track } from "../../ports/player";

export interface MoreByInput {
  albumId: string;
  artist: { id?: string; name: string };
  loaded: readonly ArtistReleaseViewModel[];
  saved: readonly LibraryItemViewModel[];
  liked: readonly Track[];
}

const MAX_RELEASES = 8;

export function moreBy({ albumId, artist, loaded, saved, liked }: MoreByInput): ArtistReleaseViewModel[] {
  const name = artist.name.toLocaleLowerCase();
  const byThem = (track: Track) =>
    (artist.id !== undefined && track.artistId === artist.id) ||
    (track.artistList ?? []).some((other) => other.id === artist.id || other.name.toLocaleLowerCase() === name);
  const candidates: ArtistReleaseViewModel[] = [
    ...loaded,
    ...saved
      .filter((item) => item.kind === "album" && item.creator?.toLocaleLowerCase() === name)
      .map((item) => ({ id: item.id, kind: "album" as const, title: item.title, coverUrl: item.imageUrl ?? "" })),
    ...liked.flatMap((track) =>
      track.album && byThem(track) ? [{ id: track.album.id, kind: "album" as const, title: track.album.title, coverUrl: track.coverUrl }] : [],
    ),
  ];
  const seen = new Set([albumId]);
  const titles = new Set<string>();
  return candidates
    .filter(({ id, title }) => {
      const key = title.toLocaleLowerCase();
      if (!id || seen.has(id) || titles.has(key)) return false;
      seen.add(id);
      titles.add(key);
      return true;
    })
    .slice(0, MAX_RELEASES);
}
