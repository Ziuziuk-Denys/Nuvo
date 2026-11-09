import { TVHTML5 } from "../constants";
import { continuationOf, findAll, isObj, parseDuration, pickCover, textOf, thumbnailsOf, videoThumbnail, type Obj } from "../catalog/map";
import type { Innertube } from "../http";
import { isAbortError, type PlaylistPage, type YtTrack } from "../types";

export const MAX_PLAYLIST_LIST_PAGES = 20;
export const MAX_PLAYLIST_PAGES = 50;

export interface Profile {
  name: string;
  email?: string;
  handle?: string;
  avatarUrl?: string;
  ownsChannel: boolean;
}

export interface AccountPlaylistRow {
  id: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
}

type Call = (endpoint: string, body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export function tvCaller(yt: Innertube, authorization: (signal: AbortSignal) => Promise<string | null>): Call {
  return async (endpoint, body, signal) => {
    const auth = await authorization(signal);
    return yt.call(endpoint, body, {
      client: TVHTML5,
      authorization: auth ?? undefined,
      signal,
    });
  };
}

export function mapProfile(response: unknown): Profile | undefined {
  const items = findAll(response, "accountItem");
  const item = items.find((candidate) => candidate.isSelected === true) ?? items[0];
  const name = textOf(item?.accountName);
  if (!item || !name) return undefined;
  const photos = (Array.isArray(item.accountPhoto?.thumbnails) ? item.accountPhoto.thumbnails : []) as Obj[];
  const widest = photos.reduce<Obj | undefined>(
    (best, photo) => (typeof photo?.url === "string" && (!best || (photo.width ?? 0) > (best.width ?? 0)) ? photo : best),
    undefined,
  );
  const url = widest?.url as string | undefined;
  return {
    name,
    email: textOf(item.accountByline),
    handle: textOf(item.channelHandle),
    avatarUrl: url ? (url.startsWith("//") ? `https:${url}` : url) : undefined,
    ownsChannel: item.hasChannel === true,
  };
}

const lineTexts = (tile: Obj): Obj[] => {
  const lines = tile.metadata?.tileMetadataRenderer?.lines;
  return Array.isArray(lines) ? lines.map((line: Obj) => line?.lineRenderer).filter(isObj) : [];
};

const lineText = (line: Obj | undefined): string | undefined => {
  const items = Array.isArray(line?.items) ? line.items : [];
  return (
    items
      .map((item: Obj) => textOf(item?.lineItemRenderer?.text) ?? "")
      .filter(Boolean)
      .join(" ")
      .trim() || undefined
  );
};

const tileCover = (tile: Obj) => pickCover(thumbnailsOf(tile.header?.tileHeaderRenderer ?? tile.header?.trackTileHeaderRenderer ?? {}));

export function playlistTiles(response: unknown): AccountPlaylistRow[] {
  return findAll(response, "tileRenderer")
    .filter((tile) => tile.contentType === "TILE_CONTENT_TYPE_PLAYLIST")
    .map((tile): AccountPlaylistRow | undefined => {
      const browseId = tile.onSelectCommand?.browseEndpoint?.browseId ?? tile.contentId;
      const title = textOf(tile.metadata?.tileMetadataRenderer?.title);
      if (typeof browseId !== "string" || !title) return undefined;
      return {
        id: browseId.replace(/^VL/, ""),
        title,
        subtitle: lineText(lineTexts(tile)[0]),
        coverUrl: tileCover(tile)?.url,
      };
    })
    .filter((row): row is AccountPlaylistRow => row !== undefined);
}

async function pages<T>(
  call: Call,
  first: Record<string, unknown>,
  limit: number,
  read: (page: unknown) => T[],
  key: (item: T) => string,
  signal: AbortSignal,
): Promise<{ items: T[]; firstPage: unknown }> {
  const seen = new Set<string>();
  const items: T[] = [];
  let response = await call("browse", first, signal);
  const firstPage = response;
  for (let page = 0; page < limit; page += 1) {
    const fresh = read(response).filter((item) => !seen.has(key(item)));
    fresh.forEach((item) => seen.add(key(item)));
    items.push(...fresh);
    if (page > 0 && fresh.length === 0) break;
    const token = continuationOf(response);
    if (!token || page + 1 >= limit) break;
    try {
      response = await call("browse", { continuation: token }, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      break;
    }
  }
  return { items, firstPage };
}

export async function accountPlaylists(call: Call, signal: AbortSignal): Promise<AccountPlaylistRow[]> {
  return (await pages(call, { browseId: "FEmusic_liked_playlists" }, MAX_PLAYLIST_LIST_PAGES, playlistTiles, (row) => row.id, signal)).items;
}

const LABELS = new Set(["playlist", "auto playlist", "album", "ep", "single"]);
const VISIBILITY = new Set(["private", "public", "unlisted"]);

export function isBylineNoise(value: string): boolean {
  const text = value.trim().toLowerCase();
  return (
    !text ||
    LABELS.has(text) ||
    VISIBILITY.has(text) ||
    /^\d{4}$/.test(text) ||
    /^[\d,.\s]+\s+(songs?|videos?|tracks?)$/.test(text) ||
    text.startsWith("updated ")
  );
}

function videoTiles(response: unknown): YtTrack[] {
  const out: YtTrack[] = [];
  for (const tile of findAll(response, "tileRenderer")) {
    const trackHeader = tile.header?.trackTileHeaderRenderer;
    if (tile.contentType !== "TILE_CONTENT_TYPE_VIDEO" && !trackHeader) continue;
    const id = (typeof tile.contentId === "string" ? tile.contentId : undefined) ?? tile.onSelectCommand?.watchEndpoint?.videoId;
    const title = textOf(tile.metadata?.tileMetadataRenderer?.title) ?? textOf(trackHeader?.title);
    if (typeof id !== "string" || !title) continue;
    const firstLine = lineTexts(tile)[0];
    const runItem = (Array.isArray(firstLine?.items) ? firstLine.items : []).map((item: Obj) => item?.lineItemRenderer?.text).find(isObj);
    const browseId = runItem?.runs?.find((run: Obj) => typeof run?.navigationEndpoint?.browseEndpoint?.browseId === "string")?.navigationEndpoint.browseEndpoint
      .browseId;
    const artistText = lineText(firstLine) ?? textOf(tile.onLongPressCommand?.showMenuCommand?.subtitle);
    const overlay = (Array.isArray(tile.header?.tileHeaderRenderer?.thumbnailOverlays) ? tile.header.tileHeaderRenderer.thumbnailOverlays : [])
      .map((item: Obj) => textOf(item?.thumbnailOverlayTimeStatusRenderer?.text))
      .find(Boolean);
    out.push({
      id,
      title,
      artists: [
        {
          id: typeof browseId === "string" ? browseId : "unknown",
          name: (artistText ?? "").replace(/ - Topic$/, "").trim() || "Unknown artist",
        },
      ],
      durationMs: parseDuration(overlay ?? textOf(trackHeader?.duration)) ?? 0,
      cover: tileCover(tile) ?? videoThumbnail(id),
      explicit: false,
    });
  }
  return out;
}

export async function accountPlaylistPage(call: Call, id: string, signal: AbortSignal): Promise<PlaylistPage | undefined> {
  const { items, firstPage } = await pages(call, { browseId: `VL${id}` }, MAX_PLAYLIST_PAGES, videoTiles, (track) => track.id, signal);
  const entity = findAll(firstPage, "entityMetadataRenderer")[0];
  const title = textOf(entity?.title);
  if (!title) return undefined;
  const bylines = (Array.isArray(entity?.bylines) ? entity.bylines : [])
    .map((byline: Obj) => lineText(byline?.lineRenderer))
    .filter((text: string | undefined): text is string => Boolean(text));
  return {
    id,
    title,
    author: bylines.find((text: string) => !isBylineNoise(text)),
    cover: items[0]?.cover,
    trackCount: items.length,
    tracks: items,
  };
}
