import { coreRequest } from "@/data/core/request";
import { toSnapshot } from "@/engine/snapshot";
import type { Track } from "@/engine/types";
import { CoreError } from "@/imports/core";

export interface LastfmStatus {
  hasCredentials: boolean;
  connected: boolean;
  user: string | null;
  enabled: boolean;
  queued: number;
  lastError: string | null;
}

export interface LastfmToken {
  token: string;
  authUrl: string;
}

export const readLastfm = (): Promise<LastfmStatus> => coreRequest("GET", "/v1/lastfm/status");

/** A changed key or secret drops the session and the queue, so plays never reach another account. */
export const saveLastfmKeys = (apiKey: string, apiSecret: string): Promise<LastfmStatus> => coreRequest("PATCH", "/v1/lastfm/settings", { apiKey, apiSecret });

export const setLastfmEnabled = (enabled: boolean): Promise<LastfmStatus> => coreRequest("PATCH", "/v1/lastfm/settings", { enabled });

export const startLastfmAuth = (): Promise<LastfmToken> => coreRequest("POST", "/v1/lastfm/auth/token");

/** Answers 409 until the user approved Nuvo on the Last.fm page. */
export const finishLastfmAuth = (token: string): Promise<LastfmStatus> => coreRequest("POST", "/v1/lastfm/auth/session", { token });

export const reportNowPlaying = (track: Track): Promise<void> =>
  coreRequest("POST", "/v1/me/playback/now-playing", { trackId: track.id, trackSnapshot: toSnapshot(track) });

export const disconnectLastfm = (): Promise<LastfmStatus> => coreRequest("DELETE", "/v1/lastfm/session");

export function lastfmErrorKey(error: unknown): string {
  if (error instanceof CoreError && error.status === 409) return "settings.lastfm.not_approved";
  if (error instanceof CoreError && error.status === 400) return "settings.lastfm.refused";
  return "settings.lastfm.unreachable";
}
