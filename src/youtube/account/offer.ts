/** The sign-in sheet's behaviour without its visuals. */
import { isAbortError, type DeviceCode } from "../types";
import type { Profile } from "./tv";

export type OfferState = { phase: "closed" } | { phase: "asking" } | { phase: "waiting"; code: DeviceCode } | { phase: "error"; reason: string };

export interface OfferAccount {
  status(): boolean;
  enabled(): boolean;
  beginSignIn(signal: AbortSignal): Promise<DeviceCode>;
  awaitSignIn(code: DeviceCode, signal: AbortSignal): Promise<void>;
  profile(signal: AbortSignal): Promise<Profile | undefined>;
}

export interface OfferHooks {
  /** Playback opened the sheet: resume the track after sign-in. */
  resume?: () => void;
  /** Playback opened the sheet: move on (next fallback or next track) after "Not now". */
  continuePlayback?: () => void;
}

export class SignInOffer {
  state: OfferState = { phase: "closed" };
  private declined = false;
  private hooks: OfferHooks = {};
  private fromPlayback = false;
  private controller: AbortController | null = null;
  private listeners = new Set<(state: OfferState) => void>();

  constructor(
    private readonly account: OfferAccount,
    private readonly toast: (text: string) => void,
  ) {}

  subscribe(listener: (state: OfferState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Opens the sheet; a no-op when signed in, already open, declined, disabled or not enabled. */
  open(origin: "playback" | "settings", hooks: OfferHooks = {}): boolean {
    if (this.account.status() || this.state.phase !== "closed") return false;
    if (origin === "playback" && (this.declined || !this.account.enabled())) return false;
    this.fromPlayback = origin === "playback";
    this.hooks = hooks;
    void this.run();
    return true;
  }

  retry(): void {
    if (this.state.phase === "error") void this.run();
  }

  /** Closes, stops polling and remembers the decline for this app session. */
  notNow(): void {
    if (this.state.phase === "closed") return;
    const wasWaiting = this.state.phase === "waiting";
    this.controller?.abort();
    this.controller = null;
    this.declined = true;
    this.set({ phase: "closed" });
    if (this.fromPlayback && wasWaiting) this.hooks.continuePlayback?.();
  }

  private async run(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    try {
      for (;;) {
        this.set({ phase: "asking" });
        const code = await this.account.beginSignIn(signal);
        this.set({ phase: "waiting", code });
        try {
          await this.account.awaitSignIn(code, signal);
          break;
        } catch (error) {
          // An expired code is replaced without bothering the user.
          if ((error as { code?: string })?.code !== "auth:expired_token") throw error;
        }
      }
      this.set({ phase: "closed" });
      const profile = await this.account.profile(signal).catch(() => undefined);
      this.controller = null;
      this.toast(profile ? `Signed in as ${profile.name}${profile.email ? ` (${profile.email})` : ""}` : "Signed in to YouTube");
      if (this.fromPlayback) this.hooks.resume?.();
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      this.set({
        phase: "error",
        reason: String((error as { code?: string })?.code ?? error),
      });
    }
  }

  private set(state: OfferState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
