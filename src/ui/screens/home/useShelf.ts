import { useEffect, useRef, useState } from "react";
import type { Track } from "../../ports/recs";

export interface Shelf {
  songs: Track[];
  round: number;
  arrived: boolean;
  busy: boolean;
  refresh(): void;
}

const shown = new Map<string, Set<string>>();

function takenBy(others: string): Set<string> {
  return new Set([...shown].flatMap(([key, ids]) => (key === others ? [] : [...ids])));
}

export type ShelfLoad = (shown: Track[], taken: () => Set<string>, round: number) => Promise<Track[]>;

interface State {
  key: string;
  songs: Track[] | null;
  round: number;
}

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
