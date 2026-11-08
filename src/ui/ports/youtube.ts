import { useEffect, useState } from "react";
import { getSignInOffer, getYoutube } from "@/youtubeBoot";
import type { Profile } from "@/youtube/account/tv";

export const signOutYoutube = (): Promise<void> => getYoutube().account.disconnect();

/** Opens the sign-in offer the way the settings page asks for it. */
export function openYoutubeSignIn(): void {
  getSignInOffer().open("settings");
}

/** Whether an account is linked, and its profile once the account answers. */
export function useYoutubeAccount(): { signedIn: boolean; account: Profile | undefined; loading: boolean } {
  const account = getYoutube().account;
  const [signedIn, setSignedIn] = useState(account.status());
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [loading, setLoading] = useState(account.status());
  useEffect(() => {
    const controller = new AbortController();
    const read = () => {
      const linked = account.status();
      setSignedIn(linked);
      if (!linked) {
        setProfile(undefined);
        setLoading(false);
        return;
      }
      setLoading(true);
      account
        .profile(controller.signal)
        .then(setProfile, () => setProfile(undefined))
        .finally(() => setLoading(false));
    };
    read();
    const stop = account.onChange(read);
    return () => {
      controller.abort();
      stop();
    };
  }, [account]);
  return { signedIn, account: profile, loading };
}

type Preferences = ReturnType<ReturnType<typeof getYoutube>["account"]["preferences"]["get"]>;

/** The account preferences and a setter that patches some of them. */
export function useYoutubePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const account = getYoutube().account;
  const [prefs, setPrefs] = useState(() => account.preferences.get());
  useEffect(() => account.onChange(() => setPrefs(account.preferences.get())), [account]);
  return [prefs, (patch) => void account.preferences.set(patch).then(setPrefs, () => undefined)];
}

/** The sign-in offer's phase and its actions, for the sheet that follows it. */
export function useSignInOffer() {
  const offer = getSignInOffer();
  const [state, setState] = useState(offer.state);
  useEffect(() => offer.subscribe(setState), [offer]);
  return { state, notNow: () => offer.notNow(), retry: () => offer.retry() };
}
