import type { ContinuationRequest } from "./continuation";
import { fromSnapshot, toSnapshot } from "./snapshot";
import type { PlayerView, Track } from "./types";

export type NotInterestedScope = "exact" | "work" | "artist" | "artist_forever";

export interface NotInterestedResult {
  suppressionId: number;
  offerHideArtist: boolean;
}

export type RecsFailure = "locked" | "unavailable";

export interface HomeMix {
  id: string;
  title: string;
  description: string;
  tracks: Track[];
}

export interface Suppression {
  id: number;
  scope: NotInterestedScope;
  origin: string;
  track: Track | null;
  fadesAt: number | null;
}

const SCOPES: readonly string[] = ["exact", "work", "artist", "artist_forever"];

/** Seeds and recent ids a suggestion request sends; the daemon accepts at most 200 of each. */
export const SUGGEST_SEEDS = 50;
export const MAX_RANK_IDS = 200;

export function suggestRequest(playlistId: string, trackIds: readonly string[]): ContinuationRequest {
  return { context: `suggest:${playlistId}`, seeds: trackIds.slice(-SUGGEST_SEEDS), recent: trackIds.slice(-MAX_RANK_IDS), sessionId: null, limit: 10 };
}

export interface RecsClient {
  notInterested(track: Track, scope: NotInterestedScope): Promise<NotInterestedResult | RecsFailure>;
  undo(suppressionId: number): Promise<true | RecsFailure>;
  homeMixes(): Promise<HomeMix[]>;
  suppressions(): Promise<Suppression[] | RecsFailure>;
  coldStart(): Promise<boolean>;
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

export function skipsOnDislike(view: Pick<PlayerView, "current">, trackId: string): boolean {
  return view.current?.track.id === trackId;
}
