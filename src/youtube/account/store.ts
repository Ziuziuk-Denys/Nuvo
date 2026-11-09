import type { FetchLike } from "../http";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** Unix milliseconds. */
  expiresAt: number;
  scope?: string;
}

export interface Preferences {
  playThroughAccount: boolean;
  offerSignIn: boolean;
  showAccountPlaylists: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  playThroughAccount: true,
  offerSignIn: false,
  showAccountPlaylists: true,
};

export interface AccountStore {
  load(): Promise<{ session: StoredSession | null; preferences: Preferences }>;
  saveSession(session: StoredSession): Promise<void>;
  dropSession(): Promise<void>;
  patchPreferences(patch: Partial<Preferences>): Promise<Preferences>;
}

export function daemonAccountStore(base: string, fetchFn: FetchLike): AccountStore {
  const send = async (method: string, path: string, body?: unknown) => {
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`);
    return response;
  };
  return {
    load: async () =>
      (await (await send("GET", "/v1/youtube/account")).json()) as {
        session: StoredSession | null;
        preferences: Preferences;
      },
    saveSession: async (session) => void (await send("PUT", "/v1/youtube/account/session", session)),
    dropSession: async () => void (await send("DELETE", "/v1/youtube/account/session")),
    patchPreferences: async (patch) => (await (await send("PATCH", "/v1/youtube/account/preferences", patch)).json()) as Preferences,
  };
}

export const LEGACY_SESSION_KEY = "nuvo_youtube_tv_session";
export const LEGACY_PREFERENCES_KEY = "nuvo_youtube_preferences";

function readJson(storage: Pick<Storage, "getItem">, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function migrateLegacy(storage: Pick<Storage, "getItem" | "removeItem">, store: AccountStore): Promise<void> {
  const session = readJson(storage, LEGACY_SESSION_KEY) as Partial<StoredSession> | null | undefined;
  if (session !== undefined) {
    const valid = session && typeof session.accessToken === "string" && typeof session.refreshToken === "string" && typeof session.expiresAt === "number";
    if (valid) {
      await store.saveSession({
        accessToken: session.accessToken!,
        refreshToken: session.refreshToken!,
        tokenType: typeof session.tokenType === "string" && session.tokenType ? session.tokenType : "Bearer",
        expiresAt: session.expiresAt!,
        ...(typeof session.scope === "string" ? { scope: session.scope } : {}),
      });
    }
    storage.removeItem(LEGACY_SESSION_KEY);
  }
  const legacy = readJson(storage, LEGACY_PREFERENCES_KEY) as { state?: Record<string, unknown> } | null | undefined;
  if (legacy !== undefined) {
    const state = legacy?.state ?? {};
    const patch: Partial<Preferences> = {};
    if (typeof state.accountPlayback === "boolean") patch.playThroughAccount = state.accountPlayback;
    if (typeof state.promptSignIn === "boolean") patch.offerSignIn = state.promptSignIn;
    if (typeof state.syncLibrary === "boolean") patch.showAccountPlaylists = state.syncLibrary;
    if (Object.keys(patch).length > 0) await store.patchPreferences(patch);
    storage.removeItem(LEGACY_PREFERENCES_KEY);
  }
}
