import { createListeners } from "@/engine/listeners";
import type { ImportsDaemon } from "./core";
import type { Sleep } from "./http";
import type { ImportSummary } from "./types";
import { ImportRunner, type SearchPorts } from "./workers";

export interface ImportsSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ImportSummary[];
  started(summaries: ImportSummary[]): void;
  resume(): Promise<void>;
  refresh(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  stopAll(): void;
}

export interface SessionOptions {
  sleep?: Sleep;
  now?: () => number;
  onLibraryChange?: () => void;
}

export const REFRESH_EVERY_MS = 1_000;
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
    } catch {}
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
