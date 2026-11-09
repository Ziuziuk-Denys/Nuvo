import type { FetchLike, Innertube } from "../http";
import type { YtCatalog } from "../types";
import { Pages, playlistPage, radio, trackPage, type AccountPlaylists } from "./pages";
import { search, searchFiltered } from "./search";
import { importUrl, parseUrl } from "./urls";

export type { AccountPlaylists } from "./pages";

export function createCatalog(deps: { yt: Innertube; fetch: FetchLike; account?: AccountPlaylists }): YtCatalog {
  const { yt } = deps;
  const pages = new Pages(yt);
  return {
    search: (query, kind, signal) => search(yt, query, kind, signal),
    searchFiltered: (query, filter, signal) => searchFiltered(yt, query, filter, signal),
    track: (id, signal) => trackPage(yt, id, signal),
    album: (id, signal) => pages.album(id, signal),
    artist: (id, signal) => pages.artist(id, signal),
    artistImage: (id, signal) => pages.artistImage(id, signal),
    playlist: (id, signal) => playlistPage(yt, id, signal, deps.account),
    radio: (id, options, signal) => radio(yt, id, options, signal),
    importUrl: (url, signal) => importUrl(yt, deps.fetch, url, signal),
    parseUrl,
  };
}
