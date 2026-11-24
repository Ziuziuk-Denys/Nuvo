import { useEffect, useState } from "react";
import { coverPixels } from "../ports/covers";
import { NEUTRAL, readLight, type CoverLight } from "./readLight";

const KEPT = 60;
const known = new Map<string, CoverLight>();

export async function lightFor(cover: string): Promise<CoverLight> {
  const seen = known.get(cover);
  if (seen) return seen;
  const light = readLight(await coverPixels(cover));
  known.set(cover, light);
  if (known.size > KEPT) known.delete(known.keys().next().value!);
  return cover ? light : NEUTRAL;
}

// keeps the last light while a new cover is read, so a song change never flashes neutral
export function useCoverLight(cover: string | undefined): CoverLight | null {
  const [light, setLight] = useState<CoverLight | null>(() => (cover ? (known.get(cover) ?? null) : null));
  useEffect(() => {
    if (!cover) return;
    let live = true;
    lightFor(cover).then(
      (next) => live && setLight(next),
      () => live && setLight(NEUTRAL),
    );
    return () => {
      live = false;
    };
  }, [cover]);
  return cover ? light : NEUTRAL;
}
