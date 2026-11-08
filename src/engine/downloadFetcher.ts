/** Saves wait for audio the cache does not hold: this caches it, one track at a time, while a save runs. No polling when idle. */
import { fromSnapshot } from "./snapshot";
import type { Track } from "./types";

export const FETCH_TIMEOUT_MS = 120_000;

export interface DownloadFetcherDeps {
  base: string;
  fetch: typeof fetch;
  ensureCached(track: Track, signal: AbortSignal): Promise<boolean>;
  log(message: string, error: unknown): void;
}

export class DownloadFetcher {
  private running: Promise<void> | null = null;
  private disposed = false;
  private readonly controller = new AbortController();

  constructor(private readonly deps: DownloadFetcherDeps) {}

  /** After a save starts, and once at boot to resume saves from the last session. */
  kick(): void {
    if (this.disposed || this.running) return;
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.controller.abort();
  }

  private async next(): Promise<Track | null> {
    const response = await this.deps.fetch(`${this.deps.base}/v1/downloads/waiting?limit=1`, { signal: this.controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: unknown[] };
    return body.items?.length ? fromSnapshot(body.items[0]) : null;
  }

  /** True when the daemon took the give-up; false ends the loop so a broken daemon is not hammered. */
  private async giveUp(id: string): Promise<boolean> {
    const response = await this.deps.fetch(`${this.deps.base}/v1/downloads/items/${encodeURIComponent(id)}/failed`, {
      method: "POST",
      signal: this.controller.signal,
    });
    return response.ok;
  }

  private async loop(): Promise<void> {
    try {
      let last: string | null = null;
      for (let item = await this.next(); item && !this.disposed; item = await this.next()) {
        // listed again right after it was cached: the daemon cannot use it, so stop trying
        const again = item.id === last;
        last = item.id;
        let cached = false;
        if (!again) {
          const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
          cached = await this.deps.ensureCached(item, signal).catch((error: unknown) => {
            this.deps.log("download fetch failed", error);
            return false;
          });
        }
        if (this.disposed) return;
        // the daemon writes cached tracks itself; one that cannot be fetched is given up so the save finishes
        if (!cached && !(await this.giveUp(item.id))) return;
      }
    } catch (error) {
      if (!this.disposed) this.deps.log("download queue unavailable", error);
    }
  }
}
