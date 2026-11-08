/** Item mapping: track rows, top-result cards, non-track rows, queue rows and the search response. Pure. */
import { PLACEHOLDER_ARTIST } from "../constants";
import type { ArtistRef, SearchItem, TrackPage, YtTrack } from "../types";
import {
  ALBUM,
  ARTIST,
  PLAYLIST,
  USER_CHANNEL,
  albumFromRuns,
  artistsFromRuns,
  browseOf,
  durationFromRuns,
  hasExplicit,
  isObj,
  isSeparator,
  pickCover,
  runsOf,
  textOf,
  thumbnailsOf,
  videoThumbnail,
  watchIdOf,
  yearFromRuns,
  type Obj,
} from "./map";

const KIND_WORDS = new Set(["song", "video", "episode"]);
const COUNT = /^[\d.,\s ]+\s*[KMB]?\s+(views?|plays?|monthly\b.*)$/i;

function columns(row: Obj): { flex: Obj[]; fixed: Obj[] } {
  const flex = (Array.isArray(row.flexColumns) ? row.flexColumns : []).map((column: Obj) => column?.musicResponsiveListItemFlexColumnRenderer?.text);
  const fixed = (Array.isArray(row.fixedColumns) ? row.fixedColumns : []).map((column: Obj) => column?.musicResponsiveListItemFixedColumnRenderer?.text);
  return { flex, fixed };
}

const playButtonOf = (node: Obj) => node.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;

/** Text parts across runs, split on the `•` separator, trimmed, empty ones dropped. */
function parts(runs: Obj[]): string[] {
  return runs
    .flatMap((run) => (typeof run.text === "string" ? run.text.split("•") : []))
    .map((part: string) => part.trim())
    .filter((part: string) => part.length > 0);
}

/** A list row or a bare row renderer as a track, or `undefined` when it has no id or no title. */
export function mapTrackRow(item: unknown, fallbackArtists: ArtistRef[] = []): YtTrack | undefined {
  if (!isObj(item)) return undefined;
  const row = isObj(item.musicResponsiveListItemRenderer) ? item.musicResponsiveListItemRenderer : item;
  const { flex, fixed } = columns(row);
  const title = textOf(flex[0]);
  const id =
    (typeof row.playlistItemData?.videoId === "string" ? row.playlistItemData.videoId : undefined) ??
    watchIdOf(runsOf(flex[0])[0]?.navigationEndpoint) ??
    watchIdOf(playButtonOf(row)) ??
    watchIdOf(row.onTap) ??
    watchIdOf(row.navigationEndpoint);
  if (!id || !title) return undefined;
  const flexRuns = flex.flatMap(runsOf);
  let artists = artistsFromRuns(flexRuns);
  if (artists.length === 0) artists = fallbackArtists;
  if (artists.length === 0) {
    const first = runsOf(flex[1]).find((run) => typeof run.text === "string" && !isSeparator(run.text));
    artists = [{ id: "unknown", name: first ? first.text.trim() : PLACEHOLDER_ARTIST }];
  }
  const cover = pickCover(thumbnailsOf(row)) ?? videoThumbnail(id);
  return {
    id,
    title,
    artists,
    album: albumFromRuns(flexRuns),
    durationMs: durationFromRuns([...flexRuns, ...fixed.flatMap(runsOf)]) ?? 0,
    cover,
    explicit: hasExplicit(row),
  };
}

/** The top-result card, or any item with a title plus `onTap` or `buttons`. */
export function mapCard(item: unknown): SearchItem | undefined {
  if (!isObj(item)) return undefined;
  const card = isObj(item.musicCardShelfRenderer) ? item.musicCardShelfRenderer : item;
  const title = textOf(card.title);
  if (!title || !(card.onTap || card.buttons)) return undefined;
  const buttons: Obj[] = Array.isArray(card.buttons) ? card.buttons : [];
  const endpoints = [
    card.onTap,
    runsOf(card.title)[0]?.navigationEndpoint,
    card.navigationEndpoint,
    card.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint,
    ...buttons.flatMap((button) => [button?.buttonRenderer?.command, button?.buttonRenderer?.navigationEndpoint]),
  ];
  const target = endpoints.find((endpoint) => browseOf(endpoint) || watchIdOf(endpoint));
  if (!target) return undefined;
  const subtitle = runsOf(card.subtitle);
  const thumbs = thumbnailsOf(card);
  const browse = browseOf(target);
  if (browse?.pageType === ARTIST)
    return {
      kind: "artist",
      id: browse.browseId,
      name: title,
      cover: pickCover(thumbs, true),
    };
  if (browse?.pageType === ALBUM) {
    return {
      kind: "album",
      id: browse.browseId,
      title,
      artists: artistsFromRuns(subtitle, true),
      year: yearFromRuns(subtitle),
      cover: pickCover(thumbs),
    };
  }
  if (browse?.pageType === PLAYLIST)
    return {
      kind: "playlist",
      id: browse.browseId,
      title,
      author: parts(subtitle)[0],
      cover: pickCover(thumbs),
    };
  const videoId = watchIdOf(target);
  if (!videoId) return undefined;
  let artists = artistsFromRuns(subtitle);
  if (artists.length === 0) {
    const name = parts(subtitle).find((part) => !KIND_WORDS.has(part.toLowerCase()) && !COUNT.test(part) && !durationFromRuns([{ text: part }]));
    artists = name ? [{ id: "unknown", name }] : [{ id: "", name: PLACEHOLDER_ARTIST }];
  }
  return {
    kind: "track",
    id: videoId,
    title,
    artists,
    album: albumFromRuns(subtitle),
    durationMs: durationFromRuns(subtitle) ?? 0,
    cover: pickCover(thumbs) ?? videoThumbnail(videoId),
    explicit: hasExplicit(card),
  };
}

/** A list row that is not a track: artist, album or playlist by the row's page type. */
export function mapListRow(item: unknown): SearchItem | undefined {
  if (!isObj(item)) return undefined;
  const row = isObj(item.musicResponsiveListItemRenderer) ? item.musicResponsiveListItemRenderer : item;
  const browse = browseOf(row.navigationEndpoint);
  const { flex } = columns(row);
  const title = textOf(flex[0]);
  if (!browse || !title) return undefined;
  const second = runsOf(flex[1]);
  const thumbs = thumbnailsOf(row);
  switch (browse.pageType) {
    case ARTIST:
    case USER_CHANNEL:
      return {
        kind: "artist",
        id: browse.browseId,
        name: title,
        cover: pickCover(thumbs, true),
      };
    case ALBUM:
      return {
        kind: "album",
        id: browse.browseId,
        title,
        artists: artistsFromRuns(second, true),
        year: yearFromRuns(second),
        cover: pickCover(thumbs),
      };
    case PLAYLIST:
      return {
        kind: "playlist",
        id: browse.browseId,
        title,
        author: parts(second)[0],
        cover: pickCover(thumbs),
      };
    default:
      return undefined;
  }
}

/** One search item: card first, then track, then non-track row. */
export function mapSearchItem(item: unknown): SearchItem | undefined {
  const card = mapCard(item);
  if (card) return card;
  const track = mapTrackRow(item);
  if (track) return { kind: "track", ...track };
  return mapListRow(item);
}

export function dedupe(items: SearchItem[]): SearchItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A search response in YouTube's order, deduplicated by `kind:id`. */
export function mapSearchResponse(response: unknown): SearchItem[] {
  const sections: unknown[] = isObj(response)
    ? (response.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [])
    : [];
  const out: SearchItem[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    if (!isObj(section)) continue;
    const items: unknown[] = [];
    if (isObj(section.musicCardShelfRenderer)) {
      items.push(section.musicCardShelfRenderer);
      if (Array.isArray(section.musicCardShelfRenderer.contents)) items.push(...section.musicCardShelfRenderer.contents);
    }
    if (isObj(section.musicShelfRenderer)) if (Array.isArray(section.musicShelfRenderer.contents)) items.push(...section.musicShelfRenderer.contents);
    if (isObj(section.itemSectionRenderer)) if (Array.isArray(section.itemSectionRenderer.contents)) items.push(...section.itemSectionRenderer.contents);
    for (const item of items) {
      const mapped = mapSearchItem(item);
      if (mapped) out.push(mapped);
    }
  }
  return dedupe(out);
}

/** A `playlistPanelVideoRenderer` for the radio (`"radio"`) or for track details (`"details"`). */
export function mapQueueRow(item: unknown, mode: "radio" | "details"): TrackPage | undefined {
  if (!isObj(item)) return undefined;
  const row = isObj(item.playlistPanelVideoRenderer) ? item.playlistPanelVideoRenderer : item;
  const id = typeof row.videoId === "string" ? row.videoId : undefined;
  const title = textOf(row.title);
  if (!id || !title) return undefined;
  const bylineNode = row.longBylineText ?? row.shortBylineText ?? row.bylineText;
  const byline = runsOf(bylineNode);
  const whole = textOf(bylineNode);
  let artists: ArtistRef[];
  if (mode === "radio") {
    artists = artistsFromRuns(byline);
    if (artists.length === 0)
      artists = [
        {
          id: "",
          name: (whole?.split("•")[0].trim() || whole) ?? PLACEHOLDER_ARTIST,
        },
      ];
  } else {
    artists = artistsFromRuns(byline, true);
    if (artists.length === 0) artists = artistsFromRuns(byline).filter((artist) => artist.name);
    if (artists.length === 0) {
      const name = byline
        .map((run) => (typeof run.text === "string" ? run.text.trim() : ""))
        .find((value) => value && !isSeparator(value) && !/^\d{4}$/.test(value));
      artists = [{ id: "unknown", name: name ?? whole ?? PLACEHOLDER_ARTIST }];
    }
  }
  return {
    id,
    title,
    artists,
    album: albumFromRuns(byline),
    durationMs: durationFromRuns(runsOf(row.lengthText ?? row.duration)) ?? durationFromRuns([{ text: textOf(row.lengthText ?? row.duration) }]) ?? 0,
    cover: pickCover(thumbnailsOf(row)) ?? videoThumbnail(id),
    explicit: hasExplicit(row),
    year: yearFromRuns(byline),
  };
}
