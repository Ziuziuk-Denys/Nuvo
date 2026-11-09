import type { Track } from "../types";
import { isAbort, SourceFailure, type Alternative, type CacheProbe, type DaemonPort, type FetchJob, type FetchStatusResult, type ScDescriptor } from "./ports";

export const CACHE_PROBE_TIMEOUT_MS = 1500;
const BITRATE_MIN = 1;
const BITRATE_MAX = 2000;

const enc = encodeURIComponent;

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function clampBitrateHeader(kbps: number): number | null {
  if (!Number.isFinite(kbps)) return null;
  const value = Math.round(kbps);
  return value >= BITRATE_MIN && value <= BITRATE_MAX ? value : null;
}

export function createDaemonClient(base: string, doFetch: typeof fetch = (input, init) => fetch(input, init)): DaemonPort {
  const json = async <T>(path: string, init?: RequestInit): Promise<T | null> => {
    try {
      const response = await doFetch(`${base}${path}`, init);
      if (!response.ok) return null;
      return response.status === 204 ? (null as T | null) : ((await response.json()) as T);
    } catch {
      return null;
    }
  };
  const send = async (path: string, method: string, body?: unknown): Promise<void> => {
    try {
      await doFetch(`${base}${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {}
  };

  return {
    cacheUrl: (trackId) => `${base}/v1/cache/audio/${enc(trackId)}`,

    localUrl: (trackId) => `${base}/v1/local/tracks/${enc(trackId)}/audio`,

    async probeLocal(trackId, signal) {
      try {
        const response = await doFetch(`${base}/v1/local/tracks/${enc(trackId)}/audio`, {
          headers: { Range: "bytes=0-0" },
          signal: withTimeout(CACHE_PROBE_TIMEOUT_MS, signal),
        });
        void response.body?.cancel().catch(() => undefined);
        if (response.status !== 206 && response.status !== 200) return { ok: false, status: response.status };
        const probe = {
          codec: response.headers.get("x-nuvo-codec") ?? "",
          bitrateKbps: clampBitrateHeader(Number(response.headers.get("x-nuvo-bitrate"))),
          mime: response.headers.get("content-type") ?? "audio/*",
        };
        return { ok: true, probe };
      } catch (error) {
        if (signal?.aborted && isAbort(error)) throw error;
        return { ok: false, status: 0 };
      }
    },

    async probeCache(trackId, signal): Promise<CacheProbe | null> {
      try {
        const response = await doFetch(`${base}/v1/cache/audio/${enc(trackId)}`, {
          headers: { Range: "bytes=0-0" },
          signal: withTimeout(CACHE_PROBE_TIMEOUT_MS, signal),
        });
        void response.body?.cancel().catch(() => undefined);
        if (response.status !== 206 && response.status !== 200) return null;
        const range = response.headers.get("content-range");
        if (range && /\/0\s*$/.test(range)) return null;
        if (response.status === 200 && response.headers.get("content-length") === "0") return null;
        const bitrate = Number(response.headers.get("x-nuvo-bitrate"));
        return {
          codec: response.headers.get("x-nuvo-codec"),
          bitrateKbps: clampBitrateHeader(bitrate),
        };
      } catch {
        return null;
      }
    },

    deleteCache: (trackId) => send(`/v1/cache/audio/${enc(trackId)}`, "DELETE"),

    async putCache(trackId, body, mime, codec, bitrateKbps) {
      const kbps = clampBitrateHeader(bitrateKbps);
      try {
        const response = await doFetch(`${base}/v1/cache/audio/${enc(trackId)}`, {
          method: "PUT",
          headers: { "Content-Type": mime, "X-Nuvo-Codec": codec, ...(kbps ? { "x-nuvo-bitrate": String(kbps) } : {}) },
          body,
        });
        return response.status;
      } catch {
        return 0;
      }
    },

    async startFetch(job) {
      try {
        const response = await doFetch(`${base}/v1/cache/fetch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(job),
        });
        return response.status;
      } catch {
        return 0;
      }
    },

    async fetchStatus(trackId, signal): Promise<FetchStatusResult> {
      try {
        const response = await doFetch(`${base}/v1/cache/fetch/${enc(trackId)}`, { signal });
        if (!response.ok) return { http: response.status, job: null };
        return { http: response.status, job: (await response.json()) as FetchJob };
      } catch {
        return { http: 0, job: null };
      }
    },
    cancelFetch: (trackId) => send(`/v1/cache/fetch/${enc(trackId)}`, "DELETE"),

    async scStream(id, signal): Promise<ScDescriptor> {
      let response: Response;
      try {
        response = await doFetch(`${base}/v1/sc/tracks/${enc(id)}/stream`, { signal });
      } catch (error) {
        const name = (error as { name?: string })?.name;
        if (name === "AbortError") throw error;
        throw new SourceFailure(name === "TimeoutError" ? "timeout" : "unavailable");
      }
      if (response.ok) {
        try {
          // The wire carries `expiresAt` as an ISO time; the engine compares Unix ms.
          const wire = (await response.json()) as Omit<ScDescriptor, "expiresAt"> & { expiresAt?: unknown };
          const expiresAt = typeof wire.expiresAt === "string" ? Date.parse(wire.expiresAt) : NaN;
          return { ...wire, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
        } catch {
          throw new SourceFailure("server_error");
        }
      }
      if (response.status === 429) throw new SourceFailure("rate_limited");
      if (response.status === 503) throw new SourceFailure("timeout");
      if (response.status >= 500) throw new SourceFailure("server_error");
      throw new SourceFailure("unavailable");
    },

    getAlternative: (trackId) => json<Alternative>(`/v1/tracks/${enc(trackId)}/alternative`),
    putAlternative: (trackId, alternative) => send(`/v1/tracks/${enc(trackId)}/alternative`, "PUT", alternative),
    rejectAlternative: (trackId, altId) => send(`/v1/tracks/${enc(trackId)}/alternative/reject`, "POST", { altId }),

    async missingKept(limit): Promise<Track[]> {
      const body = await json<{ items: Track[] }>(`/v1/cache/missing?limit=${limit}`);
      return body?.items ?? [];
    },
  };
}
