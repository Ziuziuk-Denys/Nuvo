import { CoreError, type ImportsDaemon } from "./core";
import { sleep as realSleep, type Sleep } from "./http";
import type { CatalogTrack, ImportSearch } from "./types";

export interface SearchPorts {
  youtube(query: string, filter: ImportSearch["filter"], signal: AbortSignal): Promise<CatalogTrack[]>;
  soundcloud(query: string, signal: AbortSignal): Promise<CatalogTrack[]>;
}

export type StopReason = "done" | "gone" | "locked" | "error";

export interface RunnerOptions {
  workers?: number;
  sleep?: Sleep;
  onRow?(importId: string): void;
  onStopped?(importId: string, reason: StopReason): void;
}

export const MAX_WORKERS = 8;
/** Candidates kept per search; the daemon accepts up to 100. */
export const MAX_CANDIDATES = 25;
export const MAX_WAIT_MS = 60_000;
export const RETRY_MS = 2_000;
export const MAX_FAILURES = 5;
export const MAX_STARTING_MS = 60_000;

/** Retries of a rate-limited search (2, 4 and 8 s), well inside the row's one-minute lease. */
const RATE_LIMIT_RETRIES = 3;

const isRateLimit = (error: unknown) => (error as { status?: unknown } | null)?.status === 429;
const isAbort = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof DOMException && error.name === "AbortError");

export class ImportRunner {
  private readonly queue: string[] = [];
  private active: { id: string; controller: AbortController } | null = null;

  constructor(
    private readonly daemon: Pick<ImportsDaemon, "next" | "postCandidates">,
    private readonly search: SearchPorts,
    private readonly options: RunnerOptions = {},
  ) {}

  add(ids: string[]): void {
    for (const id of ids) {
      const running = this.active?.id === id && !this.active.controller.signal.aborted;
      if (!running && !this.queue.includes(id)) this.queue.push(id);
    }
    this.pump();
  }

  stop(id: string): void {
    const at = this.queue.indexOf(id);
    if (at >= 0) this.queue.splice(at, 1);
    if (this.active?.id === id) this.active.controller.abort(new DOMException("stopped", "AbortError"));
  }

  stopAll(): void {
    this.queue.length = 0;
    this.active?.controller.abort(new DOMException("stopped", "AbortError"));
  }

  get running(): string | null {
    return this.active?.id ?? null;
  }

  private pump(): void {
    if (this.active) return;
    const id = this.queue.shift();
    if (!id) return;
    const controller = new AbortController();
    this.active = { id, controller };
    const loops = Array.from({ length: this.options.workers ?? MAX_WORKERS }, () => this.loop(id, controller.signal));
    void Promise.allSettled(loops).then((results) => {
      this.active = null;
      try {
        if (!controller.signal.aborted) {
          const reasons = results.map((r) => (r.status === "fulfilled" ? r.value : "error"));
          const reason = reasons.find((r) => r !== "done") ?? "done";
          this.options.onStopped?.(id, reason);
        }
      } catch {
      } finally {
        this.pump();
      }
    });
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return (this.options.sleep ?? realSleep)(ms, signal);
  }

  private async runSearch(search: ImportSearch, signal: AbortSignal): Promise<CatalogTrack[]> {
    return search.source === "youtube" ? this.search.youtube(search.query, search.filter, signal) : this.search.soundcloud(search.query, signal);
  }

  private async loop(id: string, signal: AbortSignal): Promise<StopReason> {
    let failures = 0;
    let conflicts = 0;
    let startingMs = 0;
    let startingSteps = 0;
    const failed = async (error: unknown): Promise<StopReason | null> => {
      if (isAbort(error, signal)) throw error;
      if (error instanceof CoreError && error.status === 404) return "gone";
      if (error instanceof CoreError && error.status === 423) return "locked";
      if (error instanceof CoreError && error.status === 503) {
        if (startingMs >= MAX_STARTING_MS) return "error";
        const delay = Math.min(RETRY_MS * 2 ** startingSteps, 10_000);
        startingSteps += 1;
        startingMs += delay;
        await this.wait(delay, signal);
        return null;
      }
      failures += 1;
      if (failures >= MAX_FAILURES) return "error";
      await this.wait(RETRY_MS, signal);
      return null;
    };
    for (;;) {
      signal.throwIfAborted();
      let answer;
      try {
        answer = await this.daemon.next(id, signal);
      } catch (error) {
        const stop = await failed(error);
        if (stop) return stop;
        continue;
      }
      if (!answer || typeof answer !== "object") {
        const stop = await failed(new CoreError(200, "UPSTREAM"));
        if (stop) return stop;
        continue;
      }
      if ("done" in answer) return "done";
      failures = 0;
      startingMs = 0;
      startingSteps = 0;
      if ("wait" in answer) {
        conflicts = 0;
        await this.wait(Math.min(Math.max(answer.wait, 100), MAX_WAIT_MS), signal);
        continue;
      }
      let candidates: CatalogTrack[] = [];
      let searchFailed = false;
      for (let tries = 0; ; tries += 1) {
        try {
          candidates = (await this.runSearch(answer.search, signal)).slice(0, MAX_CANDIDATES);
          break;
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          if (isRateLimit(error) && tries < RATE_LIMIT_RETRIES) {
            await this.wait(RETRY_MS * 2 ** tries, signal);
            continue;
          }
          searchFailed = true;
          break;
        }
      }
      try {
        await this.daemon.postCandidates(
          id,
          answer.rowId,
          {
            step: answer.search.step,
            candidates,
            ...(searchFailed ? { failed: true } : {}),
          },
          signal,
        );
        failures = 0;
        conflicts = 0;
        startingMs = 0;
        startingSteps = 0;
      } catch (error) {
        // 409: lease expired and another worker answered; repeated 409s mean an unhealthy daemon
        if (error instanceof CoreError && error.status === 409) {
          conflicts += 1;
          if (conflicts >= MAX_FAILURES) return "error";
          if (conflicts > 1) await this.wait(RETRY_MS, signal);
          continue;
        }
        const stop = await failed(error);
        if (stop) return stop;
        continue;
      }
      try {
        this.options.onRow?.(id);
      } catch {}
    }
  }
}
