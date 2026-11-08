import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listeners = new Set<() => void>();
const account = vi.hoisted(() => ({
  signedIn: true,
  prefs: { playThroughAccount: true, offerSignIn: false, showAccountPlaylists: true },
}));
const fake = {
  status: () => account.signedIn,
  profile: async () => ({ name: "Ann", ownsChannel: false }),
  onChange: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  preferences: {
    get: () => ({ ...account.prefs }),
    set: vi.fn(async (patch: object) => Object.assign(account.prefs, patch)),
  },
};
vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ account: fake }), getSignInOffer: () => ({ open: vi.fn() }) }));

import { useYoutubeAccount, useYoutubePreferences } from "./youtube";

describe("youtube port", () => {
  it("reads the profile of a linked account and drops it on sign-out", async () => {
    const seen: Array<{ signedIn: boolean; name?: string }> = [];
    function Probe() {
      const { signedIn, account: profile } = useYoutubeAccount();
      seen.push({ signedIn, name: profile?.name });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    expect(seen.at(-1)).toEqual({ signedIn: true, name: "Ann" });
    account.signedIn = false;
    await act(async () => listeners.forEach((listener) => listener()));
    expect(seen.at(-1)).toEqual({ signedIn: false, name: undefined });
    act(() => root.unmount());
  });

  it("patches preferences and shows the answer", async () => {
    let current: ReturnType<typeof useYoutubePreferences> | null = null;
    function Probe() {
      current = useYoutubePreferences();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => current![1]({ offerSignIn: true }));
    expect(fake.preferences.set).toHaveBeenCalledWith({ offerSignIn: true });
    expect(current![0].offerSignIn).toBe(true);
    act(() => root.unmount());
  });
});
