import { player } from "@/engine";
import { playerEngine } from "@/engine/compat";
import { POOL_KEY } from "@/engine/poolRefresher";
import { recs, recsChanged, seedFavorites, type FavoritePick } from "./recs";

export const STARTER_PICKS = 3;
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

export async function startFromPicks(picks: readonly FavoritePick[]): Promise<boolean> {
  let seeds;
  try {
    seeds = await seedFavorites([...picks]);
  } catch {
    return false;
  }
  try {
    localStorage.removeItem(POOL_KEY);
  } catch {
    // storage blocked: the pool refresh runs on its usual day
  }
  // the first seed is the first pick's song, or the top song of the first picked artist
  playerEngine.startRadioStation(seeds[0]);
  refreshWhenStationFills();
  return true;
}
