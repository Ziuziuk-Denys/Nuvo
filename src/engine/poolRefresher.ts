/**
 * Candidate pool refresh: once a day, after a minute with nothing playing, asks the
 * daemon for seeds with stale YouTube lists (`GET /v1/recs/seeds?source=yt_radio`, at most 12) and stores each
 * seed's catalog radio (`PUT /v1/recs/pool`), then for seeds with stale SoundCloud lists asks the daemon to
 * fetch them itself (`POST /v1/recs/pool/sc-related`). One job at a time, 3 s apart. Playback stops a run at
 * once; the daemon only returns seeds still stale, so the next idle minute continues where it stopped.
 */
import type { CatalogPort } from "./adapters";
import type { KeyValue } from "./persist";
import { toSnapshot } from "./snapshot";
import { isAbort } from "./sources/ports";

export const POOL_KEY = "nuvo.recs.poolRefreshedAt";
export const POOL_EVERY_MS = 24 * 60 * 60_000;
export const POOL_IDLE_MS = 60_000;
export const POOL_GAP_MS = 3000;
export const POOL_RETRY_KEY = "nuvo.recs.poolRetryAt";
const RETRY_BACKOFF_KEY = "nuvo.recs.poolBackoffMs";
export const POOL_RETRY_MIN_MS = 30 * 60_000;
export const POOL_ITEMS = 50;
export const POOL_SOURCE = "yt_radio";
export const SC_SOURCE = "sc_related";

export interface PoolDeps {
  base: string;
  catalog: Pick<CatalogPort, "radio">;
  fetch: typeof fetch;
  storage: KeyValue;
  now(): number;
  /** True while a track plays or loads. */
  busy(): boolean;
  /** Called on every player status change; returns an unsubscribe. */
  onStatus(listener: () => void): () => void;
  log(message: string, error?: unknown): void;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export class PoolRefresher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private run: AbortController | null = null;
  private readonly off: () => void;

  constructor(private readonly deps: PoolDeps) {
    this.off = deps.onStatus(() => this.evaluate());
    this.evaluate();
  }

  dispose(): void {
    this.off();
    this.stop();
  }

  private evaluate(): void {
    if (this.deps.busy()) {
      this.stop();
      return;
    }
    if (this.run || this.timer || !this.due()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, POOL_IDLE_MS);
  }

  private due(): boolean {
    const last = Number(this.deps.storage.getItem(POOL_KEY) ?? 0);
    const age = this.deps.now() - last;
    // a negative age means the clock went back: refresh rather than wait for the stamp to pass
    if (age >= 0 && age < POOL_EVERY_MS) return false;
    // a failed run rests: no retry before the stamp, which is never more than a day ahead
    const retryAt = Number(this.deps.storage.getItem(POOL_RETRY_KEY) ?? 0);
    const wait = retryAt - this.deps.now();
    return wait <= 0 || wait > POOL_EVERY_MS;
  }

  /** A run that did not finish its day: the next try waits 30 min, doubling per failure up to a day. */
  private backOff(): void {
    const { storage, now } = this.deps;
    const previous = Number(storage.getItem(RETRY_BACKOFF_KEY) ?? 0);
    const next = previous > 0 ? Math.min(previous * 2, POOL_EVERY_MS) : POOL_RETRY_MIN_MS;
    storage.setItem(RETRY_BACKOFF_KEY, String(next));
    storage.setItem(POOL_RETRY_KEY, String(now() + next));
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.run?.abort();
    this.run = null;
  }

  private async refresh(): Promise<void> {
    const run = new AbortController();
    this.run = run;
    const { base, fetch: doFetch } = this.deps;
    let jobs = 0;
    // One source: its stale seeds, one job each, every job but the run's first 3 s after the previous one; null when the daemon did not answer.
    const pass = async (source: string, job: (seed: string) => Promise<boolean>): Promise<{ seeds: number; stored: number } | null> => {
      const response = await doFetch(`${base}/v1/recs/seeds?source=${source}`, { signal: run.signal });
      if (!response.ok) return null;
      const body = (await response.json()) as { seeds?: unknown };
      const seeds = Array.isArray(body.seeds) ? body.seeds.filter((s): s is string => typeof s === "string" && s !== "") : [];
      let stored = 0;
      for (const seed of seeds) {
        if (jobs > 0) await wait(POOL_GAP_MS, run.signal);
        jobs += 1;
        try {
          if (await job(seed)) stored += 1;
        } catch (error) {
          if (isAbort(error)) throw error;
          this.deps.log(`pool refresh: one ${source} seed failed`, error);
        }
      }
      return { seeds: seeds.length, stored };
    };
    try {
      const youtube = await pass(POOL_SOURCE, (seed) => this.storeRadio(seed, run.signal));
      const soundcloud = youtube && (await pass(SC_SOURCE, (seed) => this.storeRelated(seed, run.signal)));
      // A day with seeds but nothing stored (offline, catalog or SoundCloud down) stays open, retried after a rest.
      if (youtube && soundcloud && (youtube.seeds + soundcloud.seeds === 0 || youtube.stored + soundcloud.stored > 0)) {
        this.deps.storage.setItem(POOL_KEY, String(this.deps.now()));
        this.deps.storage.removeItem(POOL_RETRY_KEY);
        this.deps.storage.removeItem(RETRY_BACKOFF_KEY);
      } else {
        this.backOff();
      }
    } catch (error) {
      if (!isAbort(error)) this.deps.log("pool refresh failed", error);
    } finally {
      if (this.run === run) this.run = null;
    }
  }

  /** One seed's YouTube radio into the pool; false when the catalog had nothing or the daemon refused. */
  private async storeRadio(seed: string, signal: AbortSignal): Promise<boolean> {
    const items = await this.deps.catalog.radio(seed, { limit: POOL_ITEMS }, signal);
    if (items.length === 0) return false;
    const put = await this.deps.fetch(`${this.deps.base}/v1/recs/pool`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedId: seed, source: POOL_SOURCE, items: items.map(toSnapshot) }),
      signal,
    });
    return put.ok;
  }

  /** One seed's SoundCloud related tracks: the daemon finds the upload, fetches the list and stores it. */
  private async storeRelated(seed: string, signal: AbortSignal): Promise<boolean> {
    const response = await this.deps.fetch(`${this.deps.base}/v1/recs/pool/sc-related`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedId: seed }),
      signal,
    });
    return response.ok;
  }
}
