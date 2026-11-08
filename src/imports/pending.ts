/**
 * "Add to playlist" can create a playlist from a link while a song waits to be added.
 * The waiting song goes in once, as soon as a summary first names the
 * new playlist (right after the import starts, before its rows are matched); an import that
 * fails before that drops it. A failed add is retried a few times, and the song is saved until
 * it is in so a restart can finish the job.
 */
import type { Sleep } from "./http";
import type { CatalogTrack, ImportSummary } from "./types";

/** Tries per add, and the pause between them. */
export const ADD_TRIES = 3;
export const ADD_RETRY_MS = 2_000;

export interface PendingJob {
  playlistId: string;
  track: CatalogTrack;
}

/** Where a song waits across a restart; the host picks the storage. */
export interface PendingStore {
  save(job: PendingJob): void;
  clear(): void;
}

export interface PendingOptions {
  store?: PendingStore;
  sleep?: Sleep;
}

export interface PendingPorts {
  addToPlaylist(playlistId: string, track: CatalogTrack): Promise<void>;
  added(title: string): void;
  failed(): void;
}

export interface PendingTrack {
  /** Feed every summary of the import; only the first with a playlist id adds the song. */
  summary(summary: ImportSummary): void;
  /** The import failed before a playlist existed. */
  dropped(): void;
}

/** The player's track shape, as far as a playlist snapshot needs it. */
export interface PlayerTrackLike {
  id: string;
  title: string;
  artists?: string;
  artistList?: { id?: string; name: string }[];
  coverUrl?: string;
  durationMs?: number;
}

/** A daemon snapshot of a player track, so the playlist can hold a song the library has not seen. */
export function snapshotOf(track: PlayerTrackLike): CatalogTrack {
  const artists = track.artistList?.length
    ? track.artistList.map((artist) => ({
        id: artist.id ?? "",
        name: artist.name,
      }))
    : (track.artists ?? "")
        .split(", ")
        .filter(Boolean)
        .map((name) => ({ id: "", name }));
  return {
    id: track.id,
    title: track.title,
    artists,
    durationMs: track.durationMs ?? 0,
    ...(track.coverUrl ? { cover: { url: track.coverUrl } } : {}),
  };
}

const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Adds the song, retrying a few times; a saved song stays saved when every try fails. */
async function addWithRetry(job: PendingJob, ports: PendingPorts, options: PendingOptions): Promise<void> {
  const sleep = options.sleep ?? realSleep;
  const signal = new AbortController().signal;
  for (let attempt = 1; attempt <= ADD_TRIES; attempt += 1) {
    try {
      await ports.addToPlaylist(job.playlistId, job.track);
      options.store?.clear();
      ports.added(job.track.title);
      return;
    } catch {
      if (attempt < ADD_TRIES) await sleep(ADD_RETRY_MS, signal);
    }
  }
  ports.failed();
}

/** Finishes a saved add after a restart. */
export function resumePendingTrack(job: PendingJob, ports: PendingPorts, options: PendingOptions = {}): Promise<void> {
  return addWithRetry(job, ports, options);
}

export function watchPendingTrack(track: CatalogTrack, ports: PendingPorts, options: PendingOptions = {}): PendingTrack {
  let waiting = true;
  return {
    summary(summary) {
      if (!waiting || summary.targetKind !== "playlist" || !summary.targetId) return;
      waiting = false;
      const job = { playlistId: summary.targetId, track };
      options.store?.save(job);
      void addWithRetry(job, ports, options);
    },
    dropped() {
      waiting = false;
    },
  };
}
