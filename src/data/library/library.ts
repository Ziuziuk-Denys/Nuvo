import { log } from "@/data/platform/log";
import { getYoutube } from "@/youtubeBoot";
import { libraryClient } from "./client";
import { createLiked } from "./liked";
import { createCollections } from "./collections";
import { createShelf } from "./shelf";
import { loadPins } from "./pins";
import { loadTrims } from "./trims";
import { dropLegacyLibraryKeys, notifyLibraryChanged, onLibraryChange } from "./changes";

interface Library {
  liked: ReturnType<typeof createLiked>;
  collections: ReturnType<typeof createCollections>;
  shelf: ReturnType<typeof createShelf>;
}

let built: Library | null = null;

const onError = (error: unknown) => log("warn", "library", error instanceof Error ? error.message : String(error));

export function library(): Library {
  if (!built) {
    built = {
      liked: createLiked({ client: libraryClient, onError, onChange: notifyLibraryChanged }),
      collections: createCollections({ client: libraryClient, onError, onChange: notifyLibraryChanged }),
      shelf: createShelf(getYoutube().account),
    };
  }
  return built;
}

/** The daemon may still be starting at boot: read again while any part failed, at growing gaps. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

export function retryWhileFailed(failed: () => boolean, again: () => void, delays: number[] = RETRY_DELAYS_MS): void {
  const [next, ...rest] = delays;
  if (next === undefined || !failed()) return;
  setTimeout(() => {
    if (!failed()) return;
    again();
    retryWhileFailed(failed, again, rest);
  }, next);
}

export function startLibrary(): void {
  dropLegacyLibraryKeys();
  const { liked, collections, shelf } = library();
  let pinsFailed = false;
  const pins = () =>
    Promise.all([loadPins(), loadTrims()]).then(
      () => void (pinsFailed = false),
      (error: unknown) => {
        pinsFailed = true;
        onError(error);
      },
    );
  const refresh = () => {
    void liked.refresh();
    void collections.refresh();
    void shelf.load();
    void pins();
  };
  const failed = () => {
    const saved = collections.saved.getState();
    return (
      pinsFailed ||
      liked.store.getState().status === "error" ||
      collections.playlists.getState().status === "error" ||
      Object.values(saved).some((slot) => slot.error !== undefined)
    );
  };
  void Promise.all([liked.load(), collections.load(), shelf.load(), pins()]).then(() => retryWhileFailed(failed, refresh));
  onLibraryChange(refresh);
}
