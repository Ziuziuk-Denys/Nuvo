/** Adapters from the engine's ports to the daemon and the YouTube catalog. */
import type { ContinuationPort, ContinuationRequest, Suggested } from "./continuation";
import { fromSnapshot, snapshotArtists, toSnapshot } from "./snapshot";
import { createRecsClient } from "./recsClient";
import type { MatchPort } from "./sources/ports";
import { idKind, type RankReason, type Track } from "./types";

export const MAX_MATCH_STEPS = 6;
export const RADIO_CANDIDATES = 50;
export const LOCAL_CANDIDATES = 20;

/** The two YouTube catalog calls the adapters need. */
export interface CatalogPort {
  searchFiltered(query: string, filter: "songs" | "any" | "videos", signal: AbortSignal): Promise<Track[]>;
  radio(id: string, options: { limit: number }, signal: AbortSignal): Promise<Track[]>;
}

interface MatchTrack {
  id: string;
  title: string;
  artists: Array<{ id: string; name: string }>;
  durationMs: number;
  cover?: { url: string };
}

type Outcome =
  | { status: "approved"; track: MatchTrack; score: number }
  | { status: "pending"; reason: string }
  | { status: "search"; query: string; filter: "songs" | "any" | "videos" };

const toMatch = (t: Track): MatchTrack => ({
  id: t.id,
  title: t.title,
  artists: snapshotArtists(t),
  durationMs: t.durationMs,
  ...(t.coverUrl ? { cover: { url: t.coverUrl } } : {}),
});
const fromMatch = (t: MatchTrack, like: Track): Track => ({
  ...like,
  id: t.id,
  title: t.title,
  artists: t.artists.map((a) => a.name).join(", "),
  artistList: t.artists,
  durationMs: t.durationMs,
  coverUrl: t.cover?.url ?? like.coverUrl,
});

async function post<T>(doFetch: typeof fetch, url: string, body: unknown, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    return response.ok ? ((await response.json()) as T) : null;
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    return null;
  }
}

/**
 * YouTube target: the daemon drives the cascade (`/v1/match/next`), the renderer runs each search it asks for.
 * SoundCloud target: the daemon runs the cascade with its own client (`POST /v1/match/approved`).
 */
export function createMatchAdapter(base: string, catalog: CatalogPort, doFetch: typeof fetch = (i, n) => fetch(i, n)): MatchPort {
  return {
    async approvedOn(target, track, signal, exclude) {
      const source = { title: track.title, artists: snapshotArtists(track).map((a) => a.name), durationMs: track.durationMs };
      const skip = [...(exclude ?? [])];
      if (target === "soundcloud") {
        const outcome = await post<Outcome>(doFetch, `${base}/v1/match/approved`, { target, source, exclude: skip }, signal);
        return outcome?.status === "approved" ? { track: fromMatch(outcome.track, track), score: outcome.score } : null;
      }
      const candidates = new Map<string, MatchTrack>();
      const steps: Array<{ query: string; filter: string; failed: boolean; found: number }> = [];
      for (let i = 0; i < MAX_MATCH_STEPS; i++) {
        const outcome = await post<Outcome>(doFetch, `${base}/v1/match/next`, { source, candidates: [...candidates.values()], steps }, signal);
        if (!outcome) return null;
        if (outcome.status === "approved") return skip.includes(outcome.track.id) ? null : { track: fromMatch(outcome.track, track), score: outcome.score };
        if (outcome.status === "pending") return null;
        let found: Track[] = [];
        let failed = false;
        try {
          found = await catalog.searchFiltered(outcome.query, outcome.filter, signal);
        } catch (error) {
          if ((error as { name?: string })?.name === "AbortError") throw error;
          failed = true;
        }
        // The daemon reads `candidates` as each step's results in step order, so a step counts only the ids it added.
        const before = candidates.size;
        for (const t of found) if (!skip.includes(t.id) && !candidates.has(t.id)) candidates.set(t.id, toMatch(t));
        steps.push({ query: outcome.query, filter: outcome.filter, failed, found: candidates.size - before });
      }
      return null;
    },
  };
}

/** A SoundCloud track id (`sc:<n>`); the YouTube radio cannot start from one. */
const isSoundCloud = (id: string) => id.startsWith("sc:");

/**
 * Candidates from the seed's catalog list, ranked by the daemon, which adds its stored lists. A list that fails is empty,
 * so the daemon still fills the batch; any daemon failure keeps the raw list.
 */
const PER_ARTIST = 2;

const names = (artists: string): string[] =>
  artists
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

/** Tracks the user hid ("Not interested"), read when ranking is down so the raw list still respects them. */
async function hiddenBy(base: string, doFetch: typeof fetch, signal: AbortSignal): Promise<(track: Track) => boolean> {
  const client = createRecsClient(base, (input, init) => doFetch(input, { ...init, signal }));
  const list = await client.suppressions();
  if (list === "locked" || list === "unavailable") return () => false;
  const live = list.filter((s) => s.track && (s.fadesAt === null || s.fadesAt > Date.now()));
  return (candidate) =>
    live.some((s) => {
      const hiddenTrack = s.track!;
      if (s.scope === "exact") return hiddenTrack.id === candidate.id;
      if (s.scope === "work")
        return hiddenTrack.title.toLowerCase() === candidate.title.toLowerCase() && hiddenTrack.artists.toLowerCase() === candidate.artists.toLowerCase();
      const banned = names(hiddenTrack.artists);
      return names(candidate.artists).some((name) => banned.includes(name));
    });
}

function capPerArtist(tracks: Track[]): Track[] {
  const seen = new Map<string, number>();
  return tracks.filter((t) => {
    const key = names(t.artists)[0] ?? t.id;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count < PER_ARTIST;
  });
}

export function createContinuation(base: string, catalog: CatalogPort, doFetch: typeof fetch = (i, n) => fetch(i, n), match?: MatchPort): ContinuationPort {
  // SoundCloud related tracks through the daemon for a SoundCloud seed, the YouTube radio otherwise.
  const listFor = async (seed: string, signal: AbortSignal): Promise<Track[]> => {
    try {
      if (!isSoundCloud(seed)) return await catalog.radio(seed, { limit: RADIO_CANDIDATES }, signal);
      const response = await doFetch(`${base}/v1/sc/tracks/${seed}/related?limit=${RADIO_CANDIDATES}`, { signal });
      if (!response.ok) return [];
      const body = (await response.json()) as { items?: unknown };
      return Array.isArray(body.items) ? body.items.map(fromSnapshot).filter((t): t is Track => t !== null) : [];
    } catch {
      return [];
    }
  };
  // files from the music folders by the seed's artist or genre, plus the seed's own snapshot
  const localRelated = async (seed: string, signal: AbortSignal): Promise<{ seed?: unknown; items?: unknown[] } | null> => {
    try {
      const response = await doFetch(`${base}/v1/local/related?seed=${encodeURIComponent(seed)}&limit=${LOCAL_CANDIDATES}`, { signal });
      if (!response.ok) return null;
      const body = (await response.json()) as { seed?: unknown; items?: unknown };
      return { seed: body.seed, items: Array.isArray(body.items) ? body.items : [] };
    } catch {
      return null;
    }
  };
  return {
    async next(request: ContinuationRequest): Promise<Suggested[]> {
      const seed = request.context.startsWith("radio:") ? request.seeds[0] : request.seeds[request.seeds.length - 1];
      if (!seed) return [];
      const signal = AbortSignal.timeout(15_000);
      let related: Awaited<ReturnType<typeof localRelated>>;
      let streamed: Track[];
      if (idKind(seed) === "local") {
        // a local seed has no catalog radio of its own: its approved YouTube match stands in
        related = await localRelated(seed, signal);
        const seedTrack = related?.seed ? fromSnapshot(related.seed) : null;
        const standIn = seedTrack && match ? await match.approvedOn("youtube", seedTrack, signal).catch(() => null) : null;
        streamed = standIn ? await listFor(standIn.track.id, signal) : [];
      } else {
        [related, streamed] = await Promise.all([localRelated(seed, signal), listFor(seed, signal)]);
      }
      const local = (related?.items ?? []).map(fromSnapshot).filter((t): t is Track => t !== null);
      const recent = new Set(request.recent);
      const raw = [...streamed, ...local].filter((t) => !recent.has(t.id) && t.id !== seed);
      const ranked = await post<{ items: Array<{ track: unknown; reason?: RankReason }> }>(
        doFetch,
        `${base}/v1/recs/rank`,
        {
          context: request.context,
          seeds: request.seeds,
          candidates: raw.map(toSnapshot),
          recent: request.recent,
          sessionId: request.sessionId ?? undefined,
          limit: request.limit,
          tzOffsetMin: new Date().getTimezoneOffset(),
        },
        signal,
      ).catch(() => null);
      if (!ranked || !Array.isArray(ranked.items)) {
        const hidden = await hiddenBy(base, doFetch, signal);
        return capPerArtist(raw.filter((t) => !hidden(t))).slice(0, request.limit);
      }
      // Our own candidates keep every field the catalog gave; a pooled or fallback track comes back as a snapshot.
      const byId = new Map(raw.map((t) => [t.id, t]));
      return ranked.items.flatMap((item) => {
        const id = (item.track as { id?: unknown } | null)?.id;
        const track = (typeof id === "string" ? byId.get(id) : undefined) ?? fromSnapshot(item.track);
        return track ? [item.reason ? { ...track, reason: item.reason } : track] : [];
      });
    },
  };
}
