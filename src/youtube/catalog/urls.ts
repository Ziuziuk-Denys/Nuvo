import { IMPORT_DEFAULT_TITLE, PLACEHOLDER_ARTIST, PLACEHOLDER_TITLE } from "../constants";
import type { FetchLike, Innertube } from "../http";
import { YtError, isAbortError, type ImportedList, type ImportedTrack, type YtTrack } from "../types";
import { continuationOf, findAll, findFirst, isObj, runsOf, textOf, videoThumbnail, type Obj } from "./map";
import { followContinuations, trackRows } from "./pages";

const HOSTS = new Set(["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"]);
export const isYoutubeHost = (host: string) => HOSTS.has(host.toLowerCase());
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^(VL)?(PL|OLAK5uy_|RD|UU)[\w-]{10,64}$/;

export function parseUrl(url: string): { videoId?: string; playlistId?: string } | undefined {
  if (url.length > 2048) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (parsed.port !== "") return undefined;
  const host = parsed.hostname.toLowerCase();
  if (!HOSTS.has(host)) return undefined;
  const out: { videoId?: string; playlistId?: string } = {};
  const list = parsed.searchParams.get("list");
  if (list && list.trim()) {
    const listId = list.startsWith("VL") ? list : `VL${list}`;
    // RD (mix) playlists fall back to video only.
    if (!listId.startsWith("VLRD") && LIST_ID.test(listId)) {
      out.playlistId = listId;
    }
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  let video: string | null | undefined;
  if (host === "youtu.be") video = segments[0];
  else {
    video = parsed.searchParams.get("v");
    const marker = segments.findIndex((segment) => segment === "v" || segment === "embed");
    if (!video && marker >= 0) video = segments[marker + 1];
  }
  if (video && VIDEO_ID.test(video)) out.videoId = video;
  return out.videoId || out.playlistId ? out : undefined;
}

function headerTexts(response: unknown): {
  title?: string;
  description?: string;
} {
  const candidates: Array<Obj | undefined> = [
    findFirst(response, "musicResponsiveHeaderRenderer"),
    findFirst(findFirst(response, "musicEditablePlaylistDetailHeaderRenderer"), "musicDetailHeaderRenderer"),
    findFirst(response, "musicDetailHeaderRenderer"),
    findFirst(response, "musicHeaderRenderer"),
    findFirst(response, "playlistHeaderRenderer"),
  ];
  const microformat = isObj(response) ? response.microformat?.microformatDataRenderer : undefined;
  const pick = (read: (header: Obj) => string | undefined) => {
    for (const header of candidates) {
      const value = header ? read(header) : undefined;
      if (value) return value;
    }
    return undefined;
  };
  const title = pick((header) => textOf(header.title)) ?? (typeof microformat?.title === "string" ? microformat.title : undefined);
  const description =
    pick((header) => textOf(header.description?.musicDescriptionShelfRenderer?.description ?? header.description ?? header.descriptionText)) ??
    (typeof microformat?.description === "string" && microformat.description ? microformat.description : undefined);
  return { title, description };
}

function toImported(track: YtTrack): ImportedTrack {
  return {
    ytId: track.id,
    title: track.title,
    artistTexts: track.artists.map((artist) => artist.name),
    artistChannelIds: track.artists.map((artist) => artist.id).filter((id) => id && id !== "unknown"),
    albumTitle: track.album?.title,
    albumBrowseId: track.album?.id,
    durationMs: track.durationMs || undefined,
    coverUrl: track.cover?.url ?? videoThumbnail(track.id).url,
  };
}

const stripArtistPrefix = (title: string, artist: string) => {
  const prefix = `${artist} - `;
  return title.toLowerCase().startsWith(prefix.toLowerCase()) ? title.slice(prefix.length).trim() || title : title;
};

async function singleVideo(yt: Innertube, fetchFn: FetchLike, videoId: string, signal: AbortSignal): Promise<{ title?: string; artist?: string }> {
  try {
    const response = await yt.call("next", { videoId }, { signal });
    const row =
      findAll(response, "playlistPanelVideoRenderer").find((candidate) => candidate.videoId === videoId) ?? findFirst(response, "playlistPanelVideoRenderer");
    const title = runsOf(row?.title)[0]?.text?.trim() || textOf(row?.title);
    const artist = runsOf(row?.longBylineText)[0]?.text?.trim();
    if (title && artist) return { title, artist };
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  try {
    const query = new URLSearchParams({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      format: "json",
    });
    const response = await fetchFn(`https://www.youtube.com/oembed?${query}`, {
      signal,
    });
    if (!response.ok) return {};
    const body = (await response.json()) as {
      title?: string;
      author_name?: string;
    };
    return {
      title: body.title?.trim() || undefined,
      artist: body.author_name?.trim() || undefined,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {};
  }
}

export async function importUrl(yt: Innertube, fetchFn: FetchLike, url: string, signal: AbortSignal): Promise<ImportedList> {
  const parsed = parseUrl(url);
  if (parsed?.playlistId) {
    const response = await yt.call("browse", { browseId: parsed.playlistId }, { signal });
    const { title, description } = headerTexts(response);
    const seen = new Set<string>();
    const tracks = trackRows(response, [], seen);
    tracks.push(...(await followContinuations(yt, continuationOf(response), (page, ids) => trackRows(page, [], ids), seen, signal)));
    if (tracks.length === 0)
      throw new YtError("empty-playlist", {
        text: "The playlist is empty. Check that it is public.",
      });
    const playlistIdWithoutVL = parsed.playlistId.startsWith("VL") ? parsed.playlistId.slice(2) : parsed.playlistId;
    const sourceUrl = `https://music.youtube.com/playlist?list=${playlistIdWithoutVL}`;
    return {
      source: "youtube",
      sourceUrl,
      title: title ?? IMPORT_DEFAULT_TITLE,
      description,
      tracks: tracks.map(toImported),
    };
  }
  if (parsed?.videoId) {
    const found = await singleVideo(yt, fetchFn, parsed.videoId, signal);
    const artist = found.artist ?? PLACEHOLDER_ARTIST;
    const title = found.title ? stripArtistPrefix(found.title, artist) : PLACEHOLDER_TITLE;
    const track: ImportedTrack = {
      ytId: parsed.videoId,
      title,
      artistTexts: [artist],
      artistChannelIds: [],
      coverUrl: videoThumbnail(parsed.videoId).url,
    };
    const sourceUrl = `https://www.youtube.com/watch?v=${parsed.videoId}`;
    return { source: "youtube", sourceUrl, title, tracks: [track] };
  }
  throw new YtError("bad-url");
}
