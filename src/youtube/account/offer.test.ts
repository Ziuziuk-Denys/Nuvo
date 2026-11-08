import { describe, expect, it, vi } from "vitest";
import { SignInOffer, type OfferAccount } from "./offer";
import { YtError, abortError, type DeviceCode } from "../types";

const code = (shownCode: string): DeviceCode => ({
  shownCode,
  verifyLink: "https://yt.be/activate",
  verifyLinkWithCode: `https://yt.be/activate?user_code=${shownCode}`,
  validUntilMs: 1,
  pollEveryMs: 5000,
});

function fakeAccount(enabled = true) {
  let signedIn = false;
  const waits: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
  }> = [];
  const account: OfferAccount & { codes: number } = {
    codes: 0,
    status: () => signedIn,
    enabled: () => enabled,
    beginSignIn: async () => code(`C${++account.codes}`),
    awaitSignIn: (_code, signal) =>
      new Promise<void>((resolve, reject) => {
        waits.push({ resolve, reject, signal });
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      }),
    profile: async () => ({
      name: "Owner",
      email: "o@example.com",
      ownsChannel: false,
    }),
  };
  return {
    account,
    approve: () => {
      signedIn = true;
      waits.at(-1)!.resolve();
    },
    expire: () => waits.at(-1)!.reject(new YtError("auth:expired_token")),
    waits,
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("sign-in offer", () => {
  it("Not now stops polling, continues playback and is remembered for the session", async () => {
    const fake = fakeAccount();
    const offer = new SignInOffer(fake.account, () => undefined);
    const continuePlayback = vi.fn();
    expect(offer.open("playback", { continuePlayback })).toBe(true);
    await flush();
    expect(offer.state.phase).toBe("waiting");
    offer.notNow();
    await flush();
    expect(fake.waits[0].signal.aborted).toBe(true);
    expect(offer.state.phase).toBe("closed");
    expect(continuePlayback).toHaveBeenCalledOnce();
    expect(offer.open("playback", { continuePlayback })).toBe(false);
    expect(offer.open("settings")).toBe(true);
  });

  it("sign-in from a playback sheet resumes the track and toasts the account", async () => {
    const fake = fakeAccount();
    const toast = vi.fn();
    const offer = new SignInOffer(fake.account, toast);
    const resume = vi.fn();
    offer.open("playback", { resume });
    await flush();
    fake.approve();
    await flush();
    expect(resume).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Signed in as Owner (o@example.com)");
    expect(offer.state.phase).toBe("closed");
    expect(offer.open("settings")).toBe(false);
  });

  it("an expired code is replaced silently; a failure shows retry", async () => {
    const fake = fakeAccount();
    const offer = new SignInOffer(fake.account, () => undefined);
    const phases: string[] = [];
    offer.subscribe((state) => phases.push(state.phase));
    offer.open("settings");
    await flush();
    fake.expire();
    await flush();
    expect(offer.state).toMatchObject({
      phase: "waiting",
      code: { shownCode: "C2" },
    });
    expect(phases).not.toContain("error");
    fake.waits.at(-1)!.reject(new YtError("auth:access_denied"));
    await flush();
    expect(offer.state).toEqual({
      phase: "error",
      reason: "auth:access_denied",
    });
    offer.retry();
    await flush();
    expect(offer.state.phase).toBe("waiting");
  });

  it("open('playback') is a no-op when disabled; no profile call", async () => {
    const fake = fakeAccount(false);
    const profile = vi.spyOn(fake.account, "profile");
    const offer = new SignInOffer(fake.account, () => undefined);
    expect(offer.open("playback")).toBe(false);
    expect(offer.state.phase).toBe("closed");
    expect(profile).not.toHaveBeenCalled();
  });

  it("notNow() while closed does nothing", async () => {
    const fake = fakeAccount();
    const offer = new SignInOffer(fake.account, () => undefined);
    const continuePlayback = vi.fn();
    offer.notNow();
    expect(continuePlayback).not.toHaveBeenCalled();
  });

  it("retry() after an error restarts the flow", async () => {
    const fake = fakeAccount();
    const offer = new SignInOffer(fake.account, () => undefined);
    offer.open("settings");
    await flush();
    fake.waits.at(-1)!.reject(new YtError("auth:access_denied"));
    await flush();
    expect(offer.state.phase).toBe("error");
    offer.retry();
    await flush();
    expect(offer.state.phase).toBe("waiting");
    expect((offer.state as { code?: { shownCode?: string } }).code?.shownCode).toBe("C2");
  });

  it("notNow() while in error closes without continuing playback", async () => {
    const fake = fakeAccount();
    const offer = new SignInOffer(fake.account, () => undefined);
    const continuePlayback = vi.fn();
    offer.open("playback", { continuePlayback });
    await flush();
    fake.waits.at(-1)!.reject(new YtError("auth:access_denied"));
    await flush();
    expect(offer.state.phase).toBe("error");
    offer.notNow();
    expect(offer.state.phase).toBe("closed");
    expect(continuePlayback).not.toHaveBeenCalled();
  });

  it("listener unsubscribe stops updates", async () => {
    const fake = fakeAccount();
    const offer = new SignInOffer(fake.account, () => undefined);
    const listener = vi.fn();
    const unsubscribe = offer.subscribe(listener);
    offer.open("settings");
    await flush();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    fake.waits.at(-1)!.reject(new YtError("auth:access_denied"));
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
