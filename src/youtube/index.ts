/**
 * The YouTube module's front door. Catalog and account are small and ready at once; the playback code loads on
 * the first stream request, and googlevideo on the first signed-in track.
 */
import type { YtPlayback } from "./playback";
import { createRuntime, type RuntimeDeps } from "./runtime";
import type { YtAccount } from "./account";
import type { YtCatalog } from "./types";

export type * from "./types";
export type { YtSource, ResolveOptions, YtPlayback } from "./playback";
export type { YtAccount } from "./account";
export type { Preferences as YoutubePreferences } from "./account/store";
export { SignInOffer, type OfferState } from "./account/offer";
export { isYoutubeHost } from "./catalog/urls";
export { videoThumbnail } from "./catalog/map";
export { ipcWorker, noWorker, type WorkerBridge, type WorkerCall } from "./playback/worker";

export interface Youtube {
  catalog: YtCatalog;
  playback: YtPlayback;
  account: YtAccount;
  /** Settles when the stored account and preferences are loaded. */
  ready: Promise<void>;
  /** Stops listeners and closes the worker bridge; safe to call twice. */
  dispose(): void;
}

export function createYoutube(deps: RuntimeDeps): Youtube {
  const runtime = createRuntime(deps);
  return {
    catalog: runtime.catalog,
    account: runtime.account,
    ready: runtime.ready,
    dispose: runtime.dispose,
    playback: {
      resolve: async (track, options, signal) => (await runtime.loadPlayback()).resolve(track, options, signal),
      fetchWhole: async (source, signal) => (await runtime.loadPlayback()).fetchWhole(source, signal),
      warmUp: () =>
        void runtime.loadPlayback().then(
          (loaded) => loaded.warmUp(),
          () => undefined,
        ),
      // Nothing to forget before the first stream request; never load playback just to reset it.
      reset: () =>
        void runtime.loadedPlayback()?.then(
          (loaded) => loaded.reset(),
          () => undefined,
        ),
    },
  };
}
