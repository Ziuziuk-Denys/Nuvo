import { useEffect, useRef, useState } from "react";
import type { Track } from "../../ports/recs";

export interface Shelf {
  songs: Track[];
  /** Counts the refreshes; a new value draws the songs in again. */
  round: number;
  /** The songs came after Home's first paint or by a refresh, so they ease in. */
  arrived: boolean;
  /** A refresh is on its way. */
  busy: boolean;
  /** Asks for other songs; the ones shown stay while it waits, and when nothing new comes. */
  refresh(): void;
}

/** What each mounted shelf shows, so two shelves on Home never show the same song. */
const shown = new Map<string, Set<string>>();

/** The ids every other shelf shows; read after an answer comes, so a shelf that answered earlier counts. */
function takenBy(others: string): Set<string> {
  return new Set([...shown].flatMap(([key, ids]) => (key === others ? [] : [...ids])));
}

/** `shown` is what the shelf shows now (nothing on the first load), `round` the refresh it is for (0 first). */
export type ShelfLoad = (shown: Track[], taken: () => Set<string>, round: number) => Promise<Track[]>;

interface State {
  key: string;
  songs: Track[] | null;
  round: number;
}

/**
 * A shelf's songs: `first` when the caller has them at once, else the first answer of `load` once it comes,
 * so a shelf that needs the daemon or the network never holds Home back. A new `key` starts over.
 */
export function useShelf(key: string, load: ShelfLoad, first?: Track[]): Shelf {
  const [state, setState] = useState<State>({ key, songs: null, round: 0 });
  const [busy, setBusy] = useState(false);
  if (state.key !== key) setState({ key, songs: null, round: 0 });
  const current = state.key === key ? state : { key, songs: null, round: 0 };
  const songs = current.songs ?? first ?? [];
  const waits = first === undefined;
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  // the key the shelf shows now; an answer for another key, or after unmount, is dropped
  const live = useRef(key);
  useEffect(() => {
    live.current = key;
    return () => {
      live.current = "";
    };
  }, [key]);

  const ids = songs.map((track) => track.id).join("\n");
  useEffect(() => {
    shown.set(key, new Set(ids.split("\n")));
    return () => void shown.delete(key);
  }, [key, ids]);

  useEffect(() => {
    if (!waits) return;
    void latest
      .current([], () => takenBy(key), 0)
      .then((next) => {
        if (live.current !== key) return;
        shown.set(key, new Set(next.map((track) => track.id)));
        setState((now) => (now.key === key ? { key, songs: next, round: 0 } : now));
      });
  }, [key, waits]);

  const refresh = () => {
    if (busy) return;
    setBusy(true);
    const round = current.round + 1;
    const before = new Set(ids.split("\n"));
    const done = (next: Track[]) => {
      setBusy(false);
      if (live.current !== key || !next.some((track) => !before.has(track.id))) return;
      shown.set(key, new Set(next.map((track) => track.id)));
      setState({ key, songs: next, round });
    };
    latest.current(songs, () => takenBy(key), round).then(done, () => done([]));
  };

  return { songs, round: current.round, arrived: waits || current.round > 0, busy, refresh };
}
