export function playlistHref(id: string): string {
  return `/library/playlist?id=${encodeURIComponent(id)}`;
}

export interface ArtistTarget {
  id?: string;
  name: string;
}

interface Credited {
  artists: string;
  artistId?: string;
  artistList?: readonly ArtistTarget[];
}

const NOT_IN_CATALOG = /^(unknown|local:.*|sc_.*)?$/;

export function catalogId({ id = "" }: ArtistTarget): string | null {
  return NOT_IN_CATALOG.test(id) ? null : id;
}

export function artistHref(artist: ArtistTarget): string {
  const id = catalogId(artist);
  const { name } = artist;
  const params = new URLSearchParams(id ? { id } : {});
  if (name) params.set("name", name);
  return `/artist?${params}`;
}

export function artistsOf(track: Credited): ArtistTarget[] {
  if (track.artistList?.length) return track.artistList.filter((artist) => artist.name);
  return track.artists
    .split(", ")
    .filter(Boolean)
    .map((name, index) => (index === 0 && track.artistId ? { id: track.artistId, name } : { name }));
}
