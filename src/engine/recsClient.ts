/** The daemon's recommendation routes the UI uses: "Not interested" with undo, and the Home mixes. */
import type { ContinuationRequest } from "./continuation";
import { fromSnapshot, toSnapshot } from "./snapshot";
import type { PlayerView, Track } from "./types";

export type NotInterestedScope = "exact" | "work" | "artist" | "artist_forever";

export interface NotInterestedResult {
  suppressionId: number;
  offerHideArtist: boolean;
}

/** Why a save failed: the vault is locked (423), or the daemon is starting, down or refused. */
export type RecsFailure = "locked" | "unavailable";

export interface HomeMix {
  id: string;
  title: string;
  description: string;
  tracks: Track[];
}

/** One "Not interested" entry as the hidden list shows it. */
export interface Suppression {
  id: number;
  scope: NotInterestedScope;
  /** `user`, or `scrub_skip` when the daemon added it after a scrub-then-skip. */
  origin: string;
  /** The track it was made on; null when the daemon no longer has it. */
  track: Track | null;
  /** Unix ms when it stops mattering; null for entries that never fade. */
  fadesAt: number | null;
}

const SCOPES: readonly string[] = ["exact", "work", "artist", "artist_forever"];

/** Seeds and recent ids a suggestion request sends; the daemon accepts at most 200 of each. */
export const SUGGEST_SEEDS = 50;
export const MAX_RANK_IDS = 200;

/** Ten suggestions for a playlist: its newest tracks as seeds, its last 200 as tracks never to repeat. */
export function suggestRequest(playlistId: string, trackIds: readonly string[]): ContinuationRequest {
  return { context: `suggest:${playlistId}`, seeds: trackIds.slice(-SUGGEST_SEEDS), recent: trackIds.slice(-MAX_RANK_IDS), sessionId: null, limit: 10 };
}

export interface RecsClient {
  notInterested(track: Track, scope: NotInterestedScope): Promise<NotInterestedResult | RecsFailure>;
  /** True when the suppression is gone, also when it already was (404); otherwise why not. */
  undo(suppressionId: number): Promise<true | RecsFailure>;
  /** `GET /v1/me/recommendations/daily-mixes`; empty on any failure. */
  homeMixes(): Promise<HomeMix[]>;
  /** `GET /v1/recs/suppressions`; entries with an unknown scope are left out. */
  suppressions(): Promise<Suppression[] | RecsFailure>;
  /** `GET /v1/recs/start`: true only when the daemon says nothing tells the taste yet; false on any failure. */
  coldStart(): Promise<boolean>;
  /** `PUT /v1/recs/starters` with the top tracks of the artists the owner named (at most 15). */
  saveStarters(tracks: Track[]): Promise<true | RecsFailure>;
}

export function createRecsClient(base: string, doFetch: typeof fetch): RecsClient {
  return {
    async notInterested(track, scope) {
      try {
        const response = await doFetch(`${base}/v1/recs/not-interested`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId: track.id, scope, track: toSnapshot(track) }),
        });
        if (response.status === 423) return "locked";
        if (!response.ok) return "unavailable";
        const body = (await response.json()) as Partial<NotInterestedResult>;
        return typeof body.suppressionId === "number" ? { suppressionId: body.suppressionId, offerHideArtist: body.offerHideArtist === true } : "unavailable";
      } catch {
        return "unavailable";
      }
    },
    async undo(suppressionId) {
      try {
        const response = await doFetch(`${base}/v1/recs/suppressions/${suppressionId}`, { method: "DELETE" });
        if (response.ok || response.status === 404) return true;
        return response.status === 423 ? "locked" : "unavailable";
      } catch {
        return "unavailable";
      }
    },
    async homeMixes() {
      try {
        const response = await doFetch(`${base}/v1/me/recommendations/daily-mixes`);
        if (!response.ok) return [];
        const body = (await response.json()) as { items?: Array<{ id?: unknown; title?: unknown; description?: unknown; tracks?: unknown }> };
        return (body.items ?? []).flatMap((mix) => {
          if (typeof mix.id !== "string" || !Array.isArray(mix.tracks)) return [];
          const tracks = mix.tracks.map(fromSnapshot).filter((t): t is Track => t !== null);
          return [
            {
              id: mix.id,
              title: typeof mix.title === "string" ? mix.title : "",
              description: typeof mix.description === "string" ? mix.description : "",
              tracks,
            },
          ];
        });
      } catch {
        return [];
      }
    },
    async suppressions() {
      try {
        const response = await doFetch(`${base}/v1/recs/suppressions`);
        if (response.status === 423) return "locked";
        if (!response.ok) return "unavailable";
        const body = (await response.json()) as { items?: unknown };
        if (!Array.isArray(body.items)) return "unavailable";
        return body.items.flatMap((raw): Suppression[] => {
          if (!raw || typeof raw !== "object") return [];
          const item = raw as { id?: unknown; scope?: unknown; origin?: unknown; track?: unknown; fadesAt?: unknown };
          if (typeof item.id !== "number" || typeof item.scope !== "string" || !SCOPES.includes(item.scope)) return [];
          const fades = typeof item.fadesAt === "string" ? Date.parse(item.fadesAt) : Number.NaN;
          return [
            {
              id: item.id,
              scope: item.scope as NotInterestedScope,
              origin: typeof item.origin === "string" ? item.origin : "user",
              track: fromSnapshot(item.track),
              fadesAt: Number.isNaN(fades) ? null : fades,
            },
          ];
        });
      } catch {
        return "unavailable";
      }
    },
    async coldStart() {
      try {
        const response = await doFetch(`${base}/v1/recs/start`);
        if (!response.ok) return false;
        const body = (await response.json()) as { needed?: unknown };
        return body.needed === true;
      } catch {
        return false;
      }
    },
    async saveStarters(tracks) {
      try {
        const response = await doFetch(`${base}/v1/recs/starters`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tracks: tracks.map(toSnapshot) }),
        });
        if (response.ok) return true;
        return response.status === 423 ? "locked" : "unavailable";
      } catch {
        return "unavailable";
      }
    },
  };
}

/** "Not interested" on the playing track skips it, wherever it came from. */
export function skipsOnDislike(view: Pick<PlayerView, "current">, trackId: string): boolean {
  return view.current?.track.id === trackId;
}
