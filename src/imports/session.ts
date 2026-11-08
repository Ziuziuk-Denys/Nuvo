/**
 * The renderer's view of import jobs: the known summaries (newest first), the workers, and a
 * resume after start or unlock. The daemon owns the jobs; nothing here is persisted.
 */
import { createListeners } from "@/engine/listeners";
import type { ImportsDaemon } from "./core";
import type { Sleep } from "./http";
import type { ImportSummary } from "./types";
import { ImportRunner, type SearchPorts } from "./workers";

export interface ImportsSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ImportSummary[];
  /** New imports from a link or a file. */
  started(summaries: ImportSummary[]): void;
  /** Reads every import and restarts the workers of running ones (app start, unlock). */
  resume(): Promise<void>;
  refresh(id: string): Promise<void>;
  /** "Done": the report goes, the playlist stays. */
  dismiss(id: string): Promise<void>;
  stopAll(): void;
}

export interface SessionOptions {
  sleep?: Sleep;
  now?: () => number;
  /** Imports write to the library: new playlists, songs added as rows are decided. */
  onLibraryChange?: () => void;
}

/** Summary refreshes per import while workers post rows. */
export const REFRESH_EVERY_MS = 1_000;
/** How often a locked or starting daemon is asked again. */
export const RESUME_RETRY_MS = 10_000;

export function createImportsSession(daemon: ImportsDaemon, search: SearchPorts, options: SessionOptions = {}): ImportsSession {
  const now = options.now ?? Date.now;
  let items: readonly ImportSummary[] = [];
  const listeners = createListeners();
  const lastRefresh = new Map<string, number>();

  const emit = listeners.emit;
  const put = (summary: ImportSummary) => {
    items = [summary, ...items.filter((item) => item.id !== summary.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    emit();
  };
  // an answer that was asked for before an applied one, or for a dismissed import, is stale
  let asked = 0;
  const applied = new Map<string, number>();
  const dismissed = new Set<string>();
  const refresh = async (id: string) => {
    const ticket = ++asked;
    try {
      const fresh = await daemon.summary(id);
      if (dismissed.has(id) || ticket < (applied.get(id) ?? 0)) return;
      applied.set(id, ticket);
      const known = items.find((item) => item.id === id);
      put(fresh);
      if (known?.done !== fresh.done || known.status !== fresh.status) options.onLibraryChange?.();
    } catch {
      // the import was deleted or the daemon is away; the next resume reads the truth
    }
  };

  const runner = new ImportRunner(daemon, search, {
    sleep: options.sleep,
    onRow: (id) => {
      const at = now();
      if (at - (lastRefresh.get(id) ?? -Infinity) < REFRESH_EVERY_MS) return;
      lastRefresh.set(id, at);
      void refresh(id);
    },
    onStopped: (id) => void refresh(id),
  });

  const run = (summaries: readonly ImportSummary[]) => runner.add(summaries.filter((s) => s.status === "running").map((s) => s.id));

  return {
    subscribe: listeners.subscribe,
    getSnapshot: () => items,
    started(summaries) {
      summaries.forEach(put);
      if (summaries.length > 0) options.onLibraryChange?.();
      run(summaries);
    },
    async resume() {
      const all = await daemon.list();
      items = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      emit();
      run(all);
    },
    refresh,
    async dismiss(id) {
      runner.stop(id);
      dismissed.add(id);
      try {
        await daemon.remove(id);
      } catch (error) {
        dismissed.delete(id);
        throw error;
      }
      items = items.filter((item) => item.id !== id);
      emit();
    },
    stopAll: () => runner.stopAll(),
  };
}

/**
 * Resumes as soon as the daemon answers: at app start it may still be starting or locked, and
 * the unlock happens elsewhere. Stops on abort.
 */
export async function resumeWhenReady(session: Pick<ImportsSession, "resume">, wait: Sleep, signal: AbortSignal): Promise<void> {
  for (;;) {
    try {
      await session.resume();
      return;
    } catch {
      await wait(RESUME_RETRY_MS, signal);
    }
  }
}
