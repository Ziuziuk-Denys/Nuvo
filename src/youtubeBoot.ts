/** Builds the YouTube module for the app and hands the engine its two ports. */
import { createYoutube, ipcWorker, noWorker, SignInOffer, type Youtube } from "./youtube";
import { engineCatalog, engineYoutube } from "./youtube/engine";
import type { BootDeps } from "./engine/boot";

export const CORE_BASE_URL = "nuvo-core://local";

let booted: { youtube: Youtube; offer: SignInOffer; dispose(): void } | null = null;

/** The app's one YouTube module, for UI callers (search, pages, import, Settings). */
export function getYoutube(): Youtube {
  if (!booted) throw new Error("bootYoutube() has not run");
  return booted.youtube;
}

/** The sign-in sheet's state machine, for the sheet and the Settings card. */
export function getSignInOffer(): SignInOffer {
  if (!booted) throw new Error("bootYoutube() has not run");
  return booted.offer;
}

export function bootYoutube(toast: (text: string) => void) {
  booted?.dispose();
  const shell = window.nuvoShell;
  const youtube = createYoutube({
    fetch: (input, init) => fetch(input, init),
    worker: shell ? ipcWorker((op, args) => shell.youtubeCall(op, args)) : noWorker,
    daemonBase: CORE_BASE_URL,
    storage: localStorage,
    log: (message) => console.warn(message),
  });
  const offer = new SignInOffer(youtube.account, toast);
  // A network change makes the last good client and the WEB_REMIX health stale.
  const onOnline = () => youtube.playback.reset();
  window.addEventListener("online", onOnline);
  const offNetwork = window.nuvoShell?.onNetworkChanged(onOnline);
  const dispose = () => {
    window.removeEventListener("online", onOnline);
    offNetwork?.();
    youtube.dispose();
    if (booted?.youtube === youtube) booted = null;
  };
  booted = { youtube, offer, dispose };
  return {
    youtube,
    offer,
    dispose,
    ports: {
      youtube: engineYoutube(youtube),
      catalog: engineCatalog(youtube),
      askForSignIn: () => void offer.open("playback"),
      offerSignIn: () => youtube.account.preferences.get().offerSignIn && !youtube.account.status(),
    } satisfies Pick<BootDeps, "youtube" | "catalog" | "askForSignIn" | "offerSignIn">,
  };
}

// A hot reload replaces this module: release the old module's listener and worker first.
import.meta.hot?.dispose(() => booted?.dispose());
