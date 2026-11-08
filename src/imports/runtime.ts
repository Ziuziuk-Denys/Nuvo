/**
 * The app's one import runtime: the daemon client, the session with its workers, and the
 * screens' actions. The shell calls `bootImports` once, after the YouTube client has booted.
 */
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
  /** Songs for one row's own search in the report. */
  searchSongs(query: string): Promise<CatalogTrack[]>;
  /** Where a song waiting for its new playlist is kept, in the library, across a restart. */
  pendingStore: PendingStore;
  /** Null when this build cannot save files (no preload channel). */
  saveReport: ((summary: ImportSummary) => Promise<void>) | null;
}

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

/** A file name a save dialog can offer: the label without path or control characters. */
export function reportFileName(label: string): string {
  const base = label
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "import"} report.csv`;
}

/** Saves and clears one after the other, so a late save never undoes a clear. Failures are quiet. */
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

/**
 * Finishes the add of a song saved before a restart. The daemon's bulk add skips a song that is
 * already in the playlist, so a crash between the add and the clear only repeats a no-op. A playlist
 * that no longer exists ends the job instead of retrying at every start.
 */
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

/**
 * Builds the runtime once; later calls only take the current translator, so names given to new
 * playlists follow a language switch. Safe to call on every render of the shell.
 */
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
    searchSongs: (query) => searchYoutube(query, "songs", new AbortController().signal),
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

/** The known imports, newest first, for the Library rows and the report. */
export function useImportSummaries() {
  const { session } = getImports();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
