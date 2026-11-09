import { player } from "@/engine";
import { POOL_KEY } from "@/engine/poolRefresher";
import { startArtistRadio } from "./catalog";
import { recs, recsChanged, seedFavorites } from "./recs";

export const STARTER_ARTISTS = 3;
const STATION_WAIT_MS = 60_000;

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

export function coldStartNeeded(): Promise<boolean> {
  return recs.coldStart();
}

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
