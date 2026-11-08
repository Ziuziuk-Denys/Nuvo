/** Cold start: Home asks for a few artists when nothing tells the taste yet. */
import { player } from "@/engine";
import { POOL_KEY } from "@/engine/poolRefresher";
import { startArtistRadio } from "./catalog";
import { recs, recsChanged, seedFavorites } from "./recs";

export const STARTER_ARTISTS = 3;
const STATION_WAIT_MS = 60_000;

/**
 * Home asks for its mixes again once the new station's first refill landed: ranking that refill stored the
 * starter's list, so New to you has tracks. Gives up after a minute (offline, or the user moved on).
 */
function refreshWhenStationFills(): void {
  const station = player().getView().context;
  if (!station?.startsWith("radio:")) return;
  const stop = () => {
    unsubscribe();
    clearTimeout(timer);
  };
  const unsubscribe = player().subscribe((view) => {
    if (view.context !== station) return stop();
    if (view.entries.length < 2) return;
    stop();
    recsChanged.dispatchEvent(new Event("change"));
  });
  const timer = setTimeout(stop, STATION_WAIT_MS);
}

/** True when the daemon says nothing tells the taste yet; false on any failure. */
export function coldStartNeeded(): Promise<boolean> {
  return recs.coldStart();
}

/**
 * Saves the artists' top tracks as taste seeds, reopens today's pool refresh so the next idle minute fetches
 * their lists, and starts a station from the first artist; Home refetches once the station fills. False when nothing was saved.
 */
export async function startFromArtists(artistIds: readonly string[]): Promise<boolean> {
  try {
    await seedFavorites(artistIds.map((id) => ({ kind: "artist", id, title: id })));
  } catch {
    return false;
  }
  try {
    localStorage.removeItem(POOL_KEY);
  } catch {
    // storage blocked: the pool refresh runs on its usual day
  }
  void startArtistRadio(artistIds[0]).then(refreshWhenStationFills, () => undefined);
  return true;
}
