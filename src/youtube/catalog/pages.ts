/** Track, album, artist, playlist and radio pages. */
import type { Innertube } from "../http";
import {
  YtError,
  isAbortError,
  type AlbumPage,
  type ArtistPage,
  type ArtistRef,
  type Cover,
  type PlaylistPage,
  type Release,
  type Single,
  type TrackPage,
  type YtTrack,
} from "../types";
import {
  ALBUM,
  ARTIST,
  USER_CHANNEL,
  artistsFromRuns,
  browseOf,
  continuationOf,
  findAll,
  findFirst,
  hasExplicit,
  isObj,
  pickCover,
  runsOf,
  textOf,
  thumbnailsOf,
  yearFromRuns,
  type Obj,
} from "./map";
import { mapQueueRow, mapTrackRow } from "./rows";
import { searchFiltered } from "./search";

export const MAX_CONTINUATIONS = 50;

/** The node holding the main track list: a playlist shelf, a continuation page, else the first music shelf. */
function mainShelf(node: unknown): unknown {
  const playlistShelf = findFirst(node, "musicPlaylistShelfRenderer");
  if (playlistShelf) return playlistShelf;
  for (const key of ["appendContinuationItemsAction", "musicPlaylistShelfContinuation", "musicShelfContinuation", "musicShelfRenderer"]) {
    const found = findFirst(node, key);
    if (found) return found;
  }
  return undefined;
}

/** Track rows of the main shelf of a page or continuation, in document order, deduplicated by id. */
export function trackRows(node: unknown, fallbackArtists: ArtistRef[] = [], seen = new Set<string>()): YtTrack[] {
  const out: YtTrack[] = [];
  for (const row of findAll(mainShelf(node), "musicResponsiveListItemRenderer")) {
    const track = mapTrackRow(row, fallbackArtists);
    if (track && !seen.has(track.id)) {
      seen.add(track.id);
      out.push(track);
    }
  }
  return out;
}

/**
 * Follows continuation tokens for at most `MAX_CONTINUATIONS` pages. Stops when a page has no token, repeats
 * the token or adds nothing. A failed page keeps what was collected and sets `outcome.partial`; an abort rejects.
 */
export async function followContinuations(
  yt: Innertube,
  firstToken: string | undefined,
  rows: (page: unknown, seen: Set<string>) => YtTrack[],
  seen: Set<string>,
  signal: AbortSignal,
  outcome?: { partial: boolean },
): Promise<YtTrack[]> {
  const out: YtTrack[] = [];
  let token = firstToken;
  for (let page = 0; token && page < MAX_CONTINUATIONS; page += 1) {
    let response: unknown;
    try {
      response = await yt.call("browse", { continuation: token }, { signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (outcome) outcome.partial = true;
      break;
    }
    const added = rows(response, seen);
    out.push(...added);
    const next = continuationOf(response);
    if (added.length === 0 || next === token) break;
    token = next;
  }
  return out;
}

export async function trackPage(yt: Innertube, id: string, signal: AbortSignal): Promise<TrackPage> {
  try {
    const response = await yt.call("next", { videoId: id }, { signal });
    const rows = findAll(response, "playlistPanelVideoRenderer");
    const row = rows.find((candidate) => candidate.selected === true) ?? rows.find((candidate) => candidate.videoId === id);
    const mapped = row ? mapQueueRow(row, "details") : undefined;
    if (mapped) return mapped;
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  const results = await searchFiltered(yt, id, "track", signal).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  const hit = results.find((item) => item.kind === "track" && item.id === id);
  if (hit && hit.kind === "track") {
    const { kind: _kind, ...track } = hit;
    return track;
  }
  throw new YtError("not-found");
}

const trackCount = (text: string | undefined) => {
  const match = text?.match(/([\d,]+)\s+tracks?\b/i);
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
};

export class Pages {
  private albumIds = new Map<string, string>();
  private artists = new Map<string, ArtistPage>();

  constructor(private readonly yt: Innertube) {}

  async album(id: string, signal: AbortSignal): Promise<AlbumPage> {
    let browseId = id;
    if (id.startsWith("OLAK5uy_")) {
      const known = this.albumIds.get(id);
      if (known) browseId = known;
      else {
        const playlist = await this.yt.call("browse", { browseId: `VL${id}` }, { signal });
        const found = JSON.stringify(playlist).match(/MPREb_[\w-]+/)?.[0];
        if (!found) throw new YtError("not-found");
        this.albumIds.set(id, found);
        browseId = found;
      }
    }
    const response = await this.yt.call("browse", { browseId }, { signal });
    const header = findFirst(response, "musicResponsiveHeaderRenderer");
    const title = textOf(header?.title);
    const artists = artistsFromRuns(runsOf(header?.straplineTextOne), true);
    if (!header || !title || artists.length === 0) throw new YtError("not-found");
    const cover = pickCover(thumbnailsOf(header));
    const tracks = trackRows(response, artists).map((track) => ({
      ...track,
      cover: cover ?? track.cover,
      album: track.album ?? { id: browseId, title },
    }));
    return {
      id: browseId,
      title,
      artists,
      year: yearFromRuns(runsOf(header.subtitle)),
      cover,
      trackCount: trackCount(textOf(header.secondSubtitle)),
      tracks,
    };
  }

  async artist(id: string, signal: AbortSignal, fallback = true): Promise<ArtistPage> {
    const cached = this.artists.get(id);
    if (cached) return cached;
    let page: ArtistPage | undefined;
    try {
      page = await this.loadArtist(id, signal);
    } catch (error) {
      if (isAbortError(error) || !fallback) throw error;
    }
    if (page) return page;
    if (fallback) {
      const results = await searchFiltered(this.yt, id, "artist", signal);
      const first = results.find((item) => item.kind === "artist");
      if (first && first.id !== id) {
        const found = await this.artist(first.id, signal, false);
        this.artists.set(id, found);
        return found;
      }
    }
    throw new YtError("not-found");
  }

  /** The artist cover, from the session's artist pages when one is cached. Never throws. */
  async artistImage(id: string, signal: AbortSignal): Promise<Cover | undefined> {
    try {
      return (this.artists.get(id) ?? (await this.artist(id, signal))).cover;
    } catch {
      return undefined;
    }
  }

  private async loadArtist(id: string, signal: AbortSignal): Promise<ArtistPage | undefined> {
    const response = await this.yt.call("browse", { browseId: id }, { signal });
    const header = ["musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer", "musicHeaderRenderer", "musicResponsiveHeaderRenderer"]
      .map((key) => findFirst(response, key))
      .find((candidate) => candidate !== undefined);
    const name = textOf(header?.title);
    if (!header || !name) return undefined;
    const listenersText = listeners(header);
    const microformat = isObj(response) ? response.microformat?.microformatDataRenderer : undefined;
    const cover = pickCover(thumbnailsOf(microformat), true) ?? pickCover(thumbnailsOf(header), true);
    const self: ArtistRef[] = [{ id, name }];
    let tracks = trackRows(response, self);
    const { albums, singles } = releases(response);
    const topSongs = findAll(response, "musicShelfRenderer")
      .map((shelf) => browseOf(runsOf(shelf.title)[0]?.navigationEndpoint) ?? browseOf(shelf.bottomEndpoint))
      .find((target) => target !== undefined);
    if (topSongs) {
      try {
        const full = await this.yt.call(
          "browse",
          {
            browseId: topSongs.browseId,
            ...(topSongs.params ? { params: topSongs.params } : {}),
          },
          { signal },
        );
        const rows = trackRows(full, self);
        if (rows.length > 0) tracks = rows;
      } catch (error) {
        if (isAbortError(error)) throw error;
      }
    }
    const page: ArtistPage = {
      id,
      name,
      verified: parseCount(listenersText) >= 50_000,
      cover,
      listenersText,
      tracks,
      albums,
      singles,
    };
    this.artists.set(id, page);
    return page;
  }
}

const LISTENERS =
  /\d[\d.,\s ]*\s*(?:[KMB]|thousand|million|billion|mln|bln|тыс\.?|тис\.?|млн|млрд)?\s*(?:monthly audience|monthly listeners|слушател\p{L}* за месяц|слухач\p{L}* за місяць)/iu;

function listeners(header: Obj): string | undefined {
  const count = header.monthlyListenerCount;
  const direct =
    textOf(count) ?? (typeof count?.accessibility?.accessibilityData?.label === "string" ? count.accessibility.accessibilityData.label : undefined);
  if (direct) return direct;
  for (const node of [header.subtitle, header.secondSubtitle]) {
    const match = textOf(node)?.match(LISTENERS);
    if (match) return match[0].trim();
  }
  return undefined;
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  тыс: 1e3,
  тис: 1e3,
  m: 1e6,
  million: 1e6,
  mln: 1e6,
  млн: 1e6,
  b: 1e9,
  billion: 1e9,
  bln: 1e9,
  млрд: 1e9,
};

/** "1.2M", "1,2 млн", "12,345", "12.345", "12 345", "3 thousand" as a number; 0 when nothing parses. */
export function parseCount(text: string | undefined): number {
  const match = text?.match(/(\d+(?:[.,\s ]\d+)*)\s*(k|m|b|thousand|million|billion|mln|bln|тыс|тис|млн|млрд)?(?![\p{L}])/iu);
  if (!match) return 0;
  const multiplier = match[2] ? MULTIPLIERS[match[2].toLowerCase()] : 1;
  let digits = match[1].replace(/[\s ]/g, "");
  const decimal = match[2] ? digits.match(/^(\d+)[.,](\d{1,2})$/) : null;
  digits = decimal ? `${decimal[1]}.${decimal[2]}` : digits.replace(/[.,]/g, "");
  return Number(digits) * multiplier;
}

/** Releases classified by album page type and the subtitle kind word; shelf titles are only a hint. */
function releases(response: unknown): { albums: Release[]; singles: Single[] } {
  const albums: Release[] = [];
  const singles: Single[] = [];
  const seen = new Set<string>();
  for (const shelf of findAll(response, "musicCarouselShelfRenderer")) {
    const hint = textOf(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title)?.toLowerCase();
    for (const entry of Array.isArray(shelf.contents) ? shelf.contents : []) {
      const item = entry?.musicTwoRowItemRenderer;
      if (!isObj(item)) continue;
      const target = browseOf(runsOf(item.title)[0]?.navigationEndpoint) ?? browseOf(item.navigationEndpoint);
      const title = textOf(item.title);
      if (target?.pageType !== ALBUM || !title || seen.has(target.browseId)) continue;
      const subtitle = runsOf(item.subtitle);
      const word = typeof subtitle[0]?.text === "string" ? subtitle[0].text.trim().toLowerCase() : "";
      const release: Release = {
        id: target.browseId,
        title,
        year: yearFromRuns(subtitle),
        cover: pickCover(thumbnailsOf(item)),
        explicit: hasExplicit(item),
      };
      if (word === "ep" || word === "single")
        singles.push({
          ...release,
          releaseKind: word === "ep" ? "ep" : "single",
        });
      else if (word === "album" || hint === "albums") albums.push(release);
      else if (hint === "singles & eps" || hint === "singles") singles.push({ ...release, releaseKind: "single" });
      else continue;
      seen.add(target.browseId);
    }
  }
  return { albums, singles };
}

const KIND_NOISE = new Set(["playlist", "album", "ep", "single", "compilation", "radio", "плейлист", "альбом", "сингл", "сборник", "радио", "мікс", "збірка"]);
const COUNT_NOISE = /^\d[\d,.\s]*\s+(tracks?|songs?|треков|трека|трек|песен|песни|песня|пісень|пісні|пісня|треків)$/i;

export function isNoise(part: string): boolean {
  const value = part.trim();
  return (
    value === "" || value === "•" || value === "-" || value === "–" || KIND_NOISE.has(value.toLowerCase()) || /^\d{4}$/.test(value) || COUNT_NOISE.test(value)
  );
}

export function mapPlaylistHeader(response: unknown, id: string): Omit<PlaylistPage, "tracks" | "more"> | undefined {
  const header = findFirst(response, "musicResponsiveHeaderRenderer");
  const title = textOf(header?.title);
  if (!header || !title) return undefined;
  const microformat = isObj(response) ? response.microformat?.microformatDataRenderer : undefined;
  const linesRuns = [...runsOf(header.straplineTextOne), ...runsOf(header.subtitle)];
  const linked = linesRuns.find((run) => {
    const target = browseOf(run.navigationEndpoint);
    return (target?.pageType === USER_CHANNEL || target?.pageType === ARTIST) && typeof run.text === "string" && run.text.trim();
  });
  const allParts = [textOf(header.straplineTextOne), textOf(header.subtitle)]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split("•"))
    .map((value) => value.trim())
    .filter((value) => !isNoise(value));
  const author = linked ? linked.text.trim() : allParts[0];
  const rest = allParts.filter((part) => part !== author);
  const description =
    textOf(header.description?.musicDescriptionShelfRenderer?.description ?? header.description) ?? (rest.length > 0 ? rest.join(", ") : undefined);
  return {
    id,
    title,
    author,
    description,
    year: yearFromRuns(runsOf(header.subtitle)),
    cover: pickCover(thumbnailsOf(header)) ?? pickCover(thumbnailsOf(microformat)),
    trackCount: trackCount(textOf(header.secondSubtitle)),
  };
}

/** The signed-in account's playlists, served from the TV browse when the id is one of them. */
export interface AccountPlaylists {
  isAccountPlaylist(id: string): boolean;
  accountPlaylist(id: string, signal: AbortSignal): Promise<PlaylistPage | undefined>;
}

export async function playlistPage(yt: Innertube, id: string, signal: AbortSignal, account?: AccountPlaylists): Promise<PlaylistPage & { partial: boolean }> {
  if (account?.isAccountPlaylist(id)) {
    const page = await account.accountPlaylist(id, signal);
    if (page) return { ...page, partial: false };
  }
  const browseId = /^(VL|MPRE|UC|FE)/.test(id) ? id : `VL${id}`;
  const response = await yt.call("browse", { browseId }, { signal });
  const header = mapPlaylistHeader(response, id);
  if (!header) throw new YtError("not-found");
  const seen = new Set<string>();
  const tracks = trackRows(response, [], seen);
  const token = continuationOf(response);
  const outcome = { partial: false };
  let rest: Promise<YtTrack[]> | undefined;
  return {
    ...header,
    tracks,
    get partial() {
      return outcome.partial;
    },
    more: token
      ? (moreSignal: AbortSignal) => {
          // single-shot: repeat calls share one walk, an abort clears it so a retry can run
          rest ??= followContinuations(yt, token, (page, ids) => trackRows(page, [], ids), seen, moreSignal, outcome).catch((error) => {
            rest = undefined;
            throw error;
          });
          return rest;
        }
      : undefined,
  };
}

export async function radio(yt: Innertube, id: string, options: { limit?: number; exclude?: ReadonlySet<string> }, signal: AbortSignal): Promise<YtTrack[]> {
  const limit = options.limit ?? 25;
  let rows = findAll(await yt.call("next", { videoId: id, playlistId: `RDAMVM${id}` }, { signal }), "playlistPanelVideoRenderer");
  if (rows.length === 0) rows = findAll(await yt.call("next", { videoId: id }, { signal }), "playlistPanelVideoRenderer");
  const out: YtTrack[] = [];
  const seen = new Set<string>([id, ...(options.exclude ?? [])]);
  for (const row of rows) {
    if (out.length >= limit) break;
    const track = mapQueueRow(row, "radio");
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    const { year: _year, ...plain } = track;
    out.push(plain);
  }
  return out;
}
