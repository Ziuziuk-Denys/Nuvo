import { useCallback, useEffect, useState } from "react";
import { genreSongs } from "../../ports/homeShelves";
import type { Track } from "../../ports/recs";
import { ringTracks } from "./discover/ring";
import { DISCOVER, starterGenres } from "./homeModel";

const LONGEST_WAIT_MS = 5_000;

export interface Starters {
  genres: Array<{ genre: string; pool(): Promise<Track[]> }>;
  ring: Track[] | null;
}

function inTurn(lists: readonly Track[][]): Track[] {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_, index) => lists.flatMap((list) => list.slice(index, index + 1))).flat();
}

export function useStarters(on: boolean, locale: string): Starters {
  const [pools] = useState(() => new Map<string, Promise<Track[]>>());
  const [ring, setRing] = useState<Track[] | null>(null);
  const pool = useCallback(
    (query: string) => {
      const known = pools.get(query) ?? genreSongs(query);
      pools.set(query, known);
      return known;
    },
    [pools],
  );

  useEffect(() => {
    if (!on) return;
    let live = true;
    const genres = starterGenres(locale);
    const lists = genres.map((): Track[] => []);
    const show = () => {
      clearTimeout(timer);
      if (live) setRing(ringTracks([{ id: DISCOVER, title: "", description: "", tracks: inTurn(lists) }]));
    };
    const timer = setTimeout(show, LONGEST_WAIT_MS);
    const all = genres.map(({ query }, index) =>
      pool(query).then((songs) => {
        lists[index] = songs;
      }),
    );
    void Promise.all(all).then(show);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [on, locale, pool]);

  return { genres: starterGenres(locale).map(({ genre, query }) => ({ genre, pool: () => pool(query) })), ring };
}
