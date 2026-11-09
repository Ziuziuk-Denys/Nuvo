import { inspectLink, matchNext, recognizeLink, soundcloudLookup, soundcloudTrack, startImport } from "./core";
import { fetchJson } from "./lookup";
import type { ImportPorts } from "./receive";
import type { LinkPorts } from "./resolve";
import type { CatalogTrack, MatchFilter } from "./types";

export interface YoutubeCatalog {
  searchTracks(query: string, filter: MatchFilter, signal: AbortSignal): Promise<CatalogTrack[]>;
  track(id: string, signal: AbortSignal): Promise<CatalogTrack | null>;
}

export function createLinkPorts(catalog: YoutubeCatalog): LinkPorts & ImportPorts {
  return {
    inspect: inspectLink,
    recognize: recognizeLink,
    matchNext,
    search: (query, filter, signal) => catalog.searchTracks(query, filter, signal),
    youtubeTrack: (id, signal) => catalog.track(id, signal),
    soundcloudLookup,
    soundcloudTrack,
    fetchJson,
    startImport,
  };
}
