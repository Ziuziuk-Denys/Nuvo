import { useEffect, useMemo } from "react";
import { playerEngine } from "../../ports/player";
import type { SearchResult } from "../../ports/search";

const PREPARE_AFTER_MS = 150;

export function usePreparedStarts(results: readonly (SearchResult | null | undefined)[], ready: boolean): void {
  const tracks = useMemo(() => results.flatMap((result) => (result?.track ? [result.track] : [])), [results]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => playerEngine.prepareStarts(tracks), PREPARE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ready, tracks]);
  useEffect(() => () => playerEngine.prepareStarts([]), []);
}
