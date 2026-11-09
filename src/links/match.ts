// shortcut: the engine's matchTrack runs the same loop, share it if both stay
import type { CatalogTrack, MatchAnswer, MatchFilter, MatchSource, MatchStep } from "./types";

/** Four steps of 25 stay within the daemon's 100-candidate limit. */
export const MAX_PER_SEARCH = 25;
const MAX_ROUNDS = 6;

export interface MatchPorts {
  matchNext(
    request: {
      source: MatchSource;
      candidates: CatalogTrack[];
      steps: MatchStep[];
    },
    signal: AbortSignal,
  ): Promise<MatchAnswer>;
  search(query: string, filter: MatchFilter, signal: AbortSignal): Promise<CatalogTrack[]>;
}

export type MatchResult = Exclude<MatchAnswer, { status: "search" }> & {
  pool: CatalogTrack[];
};

export async function matchByName(source: MatchSource, ports: MatchPorts, signal: AbortSignal): Promise<MatchResult> {
  const candidates: CatalogTrack[] = [];
  const steps: MatchStep[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    signal.throwIfAborted();
    const answer = await ports.matchNext({ source, candidates, steps }, signal);
    if (answer.status !== "search") return { ...answer, pool: candidates };
    let found: CatalogTrack[] = [];
    let failed = false;
    try {
      found = (await ports.search(answer.query, answer.filter, signal)).slice(0, MAX_PER_SEARCH);
    } catch (error) {
      if (signal.aborted) throw error;
      failed = true;
    }
    candidates.push(...found);
    steps.push({
      query: answer.query,
      filter: answer.filter,
      failed,
      found: found.length,
    });
  }
  throw new Error("the match cascade did not finish");
}

export function alternatives(result: MatchResult, limit = 5): CatalogTrack[] {
  const chosen = result.status === "approved" ? result.track.id : result.proposedTrack?.id;
  const seen = new Set(chosen ? [chosen] : []);
  const out: CatalogTrack[] = [];
  for (const track of result.pool) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
    if (out.length === limit) break;
  }
  return out;
}
