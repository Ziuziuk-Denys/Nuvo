import { MAX_TRACKS, cleanText, encodeShare, hasPackableId, type Share, type ShareTrack } from "./shareCodec";
import type { CatalogTrack, ImportRow } from "./types";

export const SHARE_PREFIX = "nuvo://share?id=";
/** One Discord message with room for a title line. */
export const LINK_BUDGET = 1_800;
export const MAX_COPY_CHARS = 60_000;
/** YouTube's anonymous list drops ids after the 50th. */
export const YOUTUBE_LIST_MAX = 50;

// Local files pass their tags only, never a path
export interface ShareItem {
  id: string;
  title: string;
  artist: string;
  durationMs?: number;
  permalinkUrl?: string;
}

export interface BuiltLink {
  link: string | null;
  density: "full" | "lean";
  overBudget: boolean;
  copyAllowed: boolean;
  skipped: number;
  trackCount: number;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SOUNDCLOUD_ID = /^sc:([1-9][0-9]{0,15})$/;

export function toShareTrack(item: ShareItem): ShareTrack | null {
  const durationSec = item.durationMs && item.durationMs > 0 ? Math.round(item.durationMs / 1000) : undefined;
  const names = { artist: item.artist, title: item.title };
  if (YOUTUBE_ID.test(item.id)) return { source: "youtube", id: item.id, ...names, durationSec };
  const soundcloud = SOUNDCLOUD_ID.exec(item.id);
  if (soundcloud) return { source: "soundcloud", id: soundcloud[1], ...names, durationSec };
  if (!cleanText(item.title)) return null;
  return { source: "text", ...names, durationSec };
}

function lean(track: ShareTrack): ShareTrack {
  if (track.source === "text" || !hasPackableId(track)) return track;
  return { source: track.source, id: track.id, durationSec: track.durationSec };
}

export async function buildShareLink(title: string, items: ShareItem[], budget = LINK_BUDGET): Promise<BuiltLink | null> {
  const tracks = items.map(toShareTrack).filter((track): track is ShareTrack => track !== null);
  const skipped = items.length - tracks.length;
  if (tracks.length === 0) return null;
  if (tracks.length > MAX_TRACKS)
    return {
      link: null,
      density: "lean",
      overBudget: true,
      copyAllowed: false,
      skipped,
      trackCount: tracks.length,
    };
  const full = SHARE_PREFIX + (await encodeShare({ title, tracks }));
  if (full.length <= budget)
    return {
      link: full,
      density: "full",
      overBudget: false,
      copyAllowed: true,
      skipped,
      trackCount: tracks.length,
    };
  const leanLink = SHARE_PREFIX + (await encodeShare({ title, tracks: tracks.map(lean) }));
  return {
    link: leanLink,
    density: "lean",
    overBudget: leanLink.length > budget,
    copyAllowed: leanLink.length <= MAX_COPY_CHARS,
    skipped,
    trackCount: tracks.length,
  };
}

export function songLine(artist: string, title: string): string {
  const cleanArtist = cleanText(artist);
  return cleanArtist ? `${cleanArtist} - ${cleanText(title)}` : cleanText(title);
}

export function sourceUrl(item: ShareItem): string | null {
  if (YOUTUBE_ID.test(item.id)) return `https://youtu.be/${item.id}`;
  if (SOUNDCLOUD_ID.test(item.id) && item.permalinkUrl?.startsWith("https://soundcloud.com/")) return item.permalinkUrl;
  return null;
}

export function youtubeListUrl(items: ShareItem[]): { url: string; total: number } | null {
  const ids = items.map((item) => item.id).filter((id) => YOUTUBE_ID.test(id));
  if (ids.length === 0) return null;
  return {
    url: `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, YOUTUBE_LIST_MAX).join(",")}`,
    total: ids.length,
  };
}

export function textList(items: ShareItem[]): string {
  return items.map((item, index) => `${index + 1}. ${songLine(item.artist, item.title)}`).join("\n");
}

export function shareMessage(heading: string, openLabel: string, link: string, source: string | null): string {
  return [heading, `${openLabel}: ${link}`, ...(source ? [source] : [])].join("\n");
}

export function catalogTrackOf(track: ShareTrack): CatalogTrack | null {
  if (track.source === "text" || track.title === undefined || track.id === undefined) return null;
  const durationMs = (track.durationSec ?? 0) * 1000;
  const artists = track.artist ? [{ id: "", name: track.artist }] : [];
  if (track.source === "soundcloud") return { id: `sc:${track.id}`, title: track.title, artists, durationMs };
  return {
    id: track.id,
    title: track.title,
    artists,
    durationMs,
    cover: {
      url: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
      width: 480,
      height: 360,
    },
  };
}

export function shareImportRows(share: Share, looked: ReadonlyMap<number, CatalogTrack>): { rows: ImportRow[]; unreadable: number } {
  const rows: ImportRow[] = [];
  let unreadable = 0;
  share.tracks.forEach((track, index) => {
    const durationMs = track.durationSec ? track.durationSec * 1000 : undefined;
    if (track.source === "text") {
      rows.push({
        title: track.title ?? "",
        artists: track.artist ? [track.artist] : [],
        durationMs,
      });
      return;
    }
    const snapshot = catalogTrackOf(track) ?? looked.get(index);
    if (!snapshot) {
      unreadable++;
      return;
    }
    rows.push({
      title: snapshot.title,
      artists: snapshot.artists.map((artist) => artist.name),
      durationMs: durationMs ?? (snapshot.durationMs || undefined),
      track: snapshot,
    });
  });
  return { rows, unreadable };
}
