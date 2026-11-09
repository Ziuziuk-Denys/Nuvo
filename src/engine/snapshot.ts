import type { Track } from "./types";

export interface TrackSnapshot {
  id: string;
  title: string;
  artists: Array<{ id: string; name: string }>;
  album?: { id: string; title: string };
  cover?: { url: string; width: number; height: number };
  durationMs: number;
}

export function snapshotArtists(track: Track): Array<{ id: string; name: string }> {
  if (track.artistList && track.artistList.length > 0) return track.artistList.map(({ id, name }) => ({ id: id ?? "", name }));
  const names = track.artists
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length > 0) return names.map((name) => ({ id: track.artistId || "unknown", name }));
  return [{ id: "unknown", name: "Unknown Artist" }];
}

export function toSnapshot(track: Track): TrackSnapshot {
  return {
    id: track.id,
    title: track.title || "Unknown Track",
    artists: snapshotArtists(track),
    ...(track.album ? { album: track.album } : {}),
    ...(track.coverUrl ? { cover: { url: track.coverUrl, width: 512, height: 512 } } : {}),
    durationMs: track.durationMs > 0 ? track.durationMs : 0,
  };
}

export function fromSnapshot(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  const artists = Array.isArray(raw.artists)
    ? raw.artists.filter((a): a is { id?: unknown; name: string } => !!a && typeof (a as { name?: unknown }).name === "string")
    : [];
  const artistList = artists.map((a) => ({ id: typeof a.id === "string" ? a.id : "", name: a.name }));
  const cover = raw.cover as { url?: unknown } | undefined;
  const album = raw.album as { id?: unknown; title?: unknown } | undefined;
  const first = artistList[0];
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "",
    artists: artistList.map((a) => a.name).join(", "),
    ...(first && first.id && first.id !== "unknown" ? { artistId: first.id } : {}),
    artistList,
    ...(album && typeof album.id === "string" && typeof album.title === "string" ? { album: { id: album.id, title: album.title } } : {}),
    coverUrl: cover && typeof cover.url === "string" ? cover.url : "",
    durationMs: typeof raw.durationMs === "number" && raw.durationMs > 0 ? raw.durationMs : 0,
  };
}
