/** Crossfade between tracks (sound part B): album runs, repeat one, A-B loop and the sleep stop keep the exact seam. Pure. */
import { defaultPolicy, type TransitionPolicy } from "./decks";
import type { PlayerView } from "../types";

export const CROSSFADE_MAX_S = 12;
/** Shorter fades sound like a glitch, so the seam stays gapless. */
export const MIN_FADE_MS = 1000;

export const crossfadePolicy: TransitionPolicy = (input) => {
  const wantedMs = input.crossfadeSeconds * 1000;
  const exact = input.albumInOrder || input.repeat === "one" || input.abLoop || input.sleepAtTrackEnd;
  if (!input.nextReady || wantedMs <= 0 || exact) return defaultPolicy(input);
  const currentMs = (input.current.endMs - input.current.startMs) / input.rate;
  const nextMs = input.next.endMs - input.next.startMs;
  const fadeMs = Math.min(wantedMs, currentMs / 2, nextMs / 2);
  if (fadeMs < MIN_FADE_MS) return defaultPolicy(input);
  return { kind: "crossfade", startAtMediaMs: input.current.endMs - fadeMs * input.rate, fadeMs };
};

/** Two neighbours of one album played in list order: a live album must not fade between songs. */
export function albumInOrder(view: Pick<PlayerView, "entries" | "index" | "shuffle">): boolean {
  if (view.shuffle) return false;
  const current = view.entries[view.index]?.track.album?.id;
  const next = view.entries[view.index + 1]?.track.album?.id;
  return Boolean(current) && current === next;
}

/** From the legacy A-B loop and sleep stores: both make the seam exact. */
export function seamFlags(
  ab: { a: number | null; b: number | null },
  sleep: { plan: { target: { kind: string } } | null },
): { abLoop: boolean; sleepAtTrackEnd: boolean } {
  return { abLoop: ab.a !== null && ab.b !== null, sleepAtTrackEnd: sleep.plan?.target.kind === "end_of_track" };
}
