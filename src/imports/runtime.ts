import { useSyncExternalStore } from "react";
import type { TFunction } from "@/i18n";
import { CORE_BASE_URL } from "@/data/core/request";
import { notifyLibraryChanged } from "@/data/library/changes";
import type { SearchItem } from "@/youtube/types";
import { getYoutube } from "@/youtubeBoot";
import { createImportActions, type ImportActions } from "./actions";
import { CoreError, createImportsDaemon, type ImportsDaemon } from "./core";
import { sleep, type Sleep } from "./http";
import { resumePendingTrack, type PendingStore } from "./pending";
import { createImportsSession, resumeWhenReady, type ImportsSession } from "./session";
import type { CatalogTrack, ImportSearch, ImportSummary } from "./types";

export interface ImportsRuntime {
  daemon: ImportsDaemon;
  session: ImportsSession;
  actions: ImportActions;
  searchSongs(query: string): Promise<CatalogTrack[]>;
  pendingStore: PendingStore;
  saveReport: ((summary: ImportSummary) => Promise<void>) | null;
}

const SEARCH_TIMEOUT_MS = 10_000;

const FILTERS = {
  songs: "track",
  any: undefined,
  videos: "video",
} as const satisfies Record<ImportSearch["filter"], unknown>;

type TrackItem = Extract<SearchItem, { kind: "track" }>;

function toCatalog(item: TrackItem): CatalogTrack {
  return {
    id: item.id,
    title: item.title,
    artists: item.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
    })),
    ...(item.album ? { album: { id: item.album.id, title: item.album.title } } : {}),
    durationMs: item.durationMs,
    ...(item.cover ? { cover: item.cover } : {}),
    ...(item.explicit ? { explicit: true } : {}),
  };
}

async function searchYoutube(query: string, filter: ImportSearch["filter"], signal: AbortSignal): Promise<CatalogTrack[]> {
  const items = await getYoutube().catalog.searchFiltered(query, FILTERS[filter], signal);
  return items.filter((item): item is TrackItem => item.kind === "track").map(toCatalog);
}

export function reportFileName(label: string): string {
  const base = label
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "import"} report.csv`;
}

// Saves and clears run in order, so a late save never undoes a clear
export function createPendingStore(daemon: Pick<ImportsDaemon, "savePendingTrack" | "clearPendingTrack">): PendingStore {
  let queue: Promise<unknown> = Promise.resolve();
  const run = (task: () => Promise<void>) => {
    queue = queue.then(task).catch(() => {});
  };
  return {
    save: (job) => run(() => daemon.savePendingTrack(job)),
    clear: () => run(() => daemon.clearPendingTrack()),
  };
}

// Bulk add skips a song already in the playlist, so a crash between add and clear is a no-op
export async function resumeSavedSong(
  daemon: Pick<ImportsDaemon, "pendingTrack" | "addToPlaylist">,
  store: PendingStore,
  options: { sleep?: Sleep } = {},
): Promise<void> {
  const job = await daemon.pendingTrack().catch(() => null);
  if (!job) return;
  await resumePendingTrack(
    job,
    {
      addToPlaylist: async (playlistId, track) => {
        try {
          await daemon.addToPlaylist(playlistId, track);
        } catch (error) {
          if (!(error instanceof CoreError && error.status === 404)) throw error;
          store.clear();
        }
      },
      added: () => {},
      failed: () => {},
    },
    { store, ...options },
  );
}

let runtime: ImportsRuntime | null = null;
let translate: TFunction = (key) => key;

export function bootImports(t: TFunction): ImportsRuntime {
  translate = t;
  if (runtime) return runtime;
  const daemon = createImportsDaemon(CORE_BASE_URL);
  const session = createImportsSession(
    daemon,
    {
      youtube: searchYoutube,
      soundcloud: (query, signal) => daemon.soundcloudSearch(query, signal),
    },
    { onLibraryChange: notifyLibraryChanged },
  );
  const shell = window.nuvoShell;
  const actions = createImportActions({
    fetch: (url, init) => fetch(url, init),
    youtube: {
      importUrl: (url, signal) => getYoutube().catalog.importUrl(url, signal),
    },
    daemon,
    labels: {
      fallback: (source) => translate(`ui.imports.fallback.${source}`),
      likes: (name) => translate("ui.imports.likes_name", { name }),
    },
    started: (summaries) => session.started(summaries),
  });
  const saveReport = shell
    ? async (summary: ImportSummary) => {
        await shell.saveTextFile(reportFileName(summary.label), await daemon.reportCsv(summary.id));
      }
    : null;
  const pendingStore = createPendingStore(daemon);
  runtime = {
    daemon,
    session,
    actions,
    searchSongs: (query) => searchYoutube(query, "songs", AbortSignal.timeout(SEARCH_TIMEOUT_MS)),
    pendingStore,
    saveReport,
  };
  void resumeWhenReady(session, sleep, new AbortController().signal).then(() => resumeSavedSong(daemon, pendingStore));
  return runtime;
}

export function getImports(): ImportsRuntime {
  if (!runtime) throw new Error("bootImports() has not run");
  return runtime;
}

export function useImportSummaries() {
  const { session } = getImports();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
