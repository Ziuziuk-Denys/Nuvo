import type { FetchLike, Innertube } from "../http";
import { YtError, type DeviceCode, type PlaylistPage } from "../types";
import { loadCredentials, pollForTokens, raceAbort, refreshTokens, requestDeviceCode, revoke, type Credentials } from "./oauth";
import { DEFAULT_PREFERENCES, type AccountStore, type Preferences, type StoredSession } from "./store";
import { accountPlaylistPage, accountPlaylists, mapProfile, tvCaller, type AccountPlaylistRow, type Profile } from "./tv";

export const REFRESH_MARGIN_MS = 60_000;
const REVOKED = new Set(["auth:invalid_grant", "auth:unauthorized_client"]);

export class YtAccount {
  private session: StoredSession | null = null;
  private prefs: Preferences = { ...DEFAULT_PREFERENCES };
  private credentials: Promise<Credentials> | null = null;
  private refreshing: Promise<string | null> | null = null;
  private generation = 0;
  private dropFailed = false;
  private listeners = new Set<() => void>();
  private known = new Set<string>(["LM"]);
  private listCache: {
    refreshToken: string;
    rows: AccountPlaylistRow[];
  } | null = null;
  private readonly call;

  constructor(
    private readonly deps: {
      fetch: FetchLike;
      yt: Innertube;
      store: AccountStore;
    },
  ) {
    this.call = tvCaller(deps.yt, (signal) => this.authorization(signal));
  }

  async init(): Promise<void> {
    const loaded = await this.deps.store.load();
    this.session = loaded.session;
    this.prefs = { ...DEFAULT_PREFERENCES, ...loaded.preferences };
    this.emit();
  }

  status(): boolean {
    return this.session !== null;
  }

  enabled(): boolean {
    return this.prefs.offerSignIn;
  }

  signOutIncomplete(): boolean {
    return this.dropFailed;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readonly preferences = {
    get: (): Preferences => ({ ...this.prefs }),
    set: async (patch: Partial<Preferences>): Promise<Preferences> => {
      this.prefs = await this.deps.store.patchPreferences(patch);
      this.emit();
      return { ...this.prefs };
    },
  };

  async beginSignIn(signal: AbortSignal): Promise<DeviceCode> {
    return requestDeviceCode(this.deps.fetch, await this.creds(signal), signal);
  }

  async awaitSignIn(code: DeviceCode, signal: AbortSignal): Promise<void> {
    const session = await pollForTokens(this.deps.fetch, await this.creds(signal), code, signal);
    await this.store(session);
  }

  async authorization(signal?: AbortSignal): Promise<string | null> {
    const session = this.session;
    if (!session) return null;
    if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return `${session.tokenType} ${session.accessToken}`;
    const generation = this.generation;
    this.refreshing ??= (async () => {
      try {
        const next = await refreshTokens(this.deps.fetch, await this.creds(), session);
        // A sign-out during the request wins: the new tokens are dropped.
        if (generation !== this.generation) return null;
        await this.store(next);
        return `${next.tokenType} ${next.accessToken}`;
      } catch (error) {
        if (generation === this.generation && error instanceof YtError && REVOKED.has(error.code)) await this.signOutLocally();
        throw error;
      }
    })().finally(() => (this.refreshing = null));
    return raceAbort(this.refreshing, signal);
  }

  /** Local tokens go first; revocation is best effort and never rejects. */
  async disconnect(): Promise<void> {
    const refreshToken = this.session?.refreshToken;
    await this.signOutLocally();
    if (refreshToken) await revoke(this.deps.fetch, refreshToken).catch(() => undefined);
  }

  async profile(signal: AbortSignal): Promise<Profile | undefined> {
    if (!this.session) return undefined;
    return mapProfile(await this.call("account/accounts_list", {}, signal));
  }

  async playlists(signal: AbortSignal): Promise<AccountPlaylistRow[]> {
    const session = this.session;
    if (!session) return [];
    if (this.listCache?.refreshToken === session.refreshToken) return this.listCache.rows;
    const rows = await accountPlaylists(this.call, signal);
    rows.forEach((row) => this.known.add(row.id));
    this.listCache = { refreshToken: session.refreshToken, rows };
    return rows;
  }

  isAccountPlaylist(id: string): boolean {
    return this.session !== null && this.known.has(id.replace(/^VL/, ""));
  }

  async accountPlaylist(id: string, signal: AbortSignal): Promise<PlaylistPage | undefined> {
    if (!this.session) return undefined;
    return accountPlaylistPage(this.call, id.replace(/^VL/, ""), signal);
  }

  /** The shared lookup carries no caller's signal; each caller only stops waiting on its own. */
  private creds(signal?: AbortSignal): Promise<Credentials> {
    this.credentials ??= loadCredentials(this.deps.fetch).catch((error) => {
      this.credentials = null;
      throw error;
    });
    return raceAbort(this.credentials, signal);
  }

  private async store(session: StoredSession): Promise<void> {
    this.session = session;
    await this.deps.store.saveSession(session);
    this.emit();
  }

  private async signOutLocally(): Promise<void> {
    this.generation += 1;
    this.session = null;
    this.listCache = null;
    this.known = new Set(["LM"]);
    this.dropFailed = false;
    this.emit();
    // One retry; if the daemon still holds the tokens, say so instead of looking clean.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.deps.store.dropSession();
        return;
      } catch {}
    }
    this.dropFailed = true;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
