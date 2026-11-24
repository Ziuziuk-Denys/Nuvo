import { useEffect, useState } from "react";

// most lyrics arrive within this, so a song change keeps its layout instead of leaving and coming back
const SEARCH_MS = 700;

export function useLyricsSide(status: string): boolean {
  const [open, setOpen] = useState(status === "ready" || status === "loading");
  const searching = status === "loading";
  const wanted = status === "ready";
  if (!searching && open !== wanted) setOpen(wanted);
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => setOpen(false), SEARCH_MS);
    return () => clearTimeout(timer);
  }, [searching]);
  return open;
}
