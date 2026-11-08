import { create } from "zustand";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { msUntilSleep, planSleep, sleepVolume, SLEEP_FADE_MS, type SleepPlan, type SleepTarget } from "./lib/sleepTimer";

const TICK_MS = 1000;
// The pause fade-out is 180 ms; restoring the master gain after it avoids a loud blip
const FADE_RESET_DELAY_MS = 400;

interface SleepState {
  plan: SleepPlan | null;
  /** Track the end-of-track target was armed on. */
  trackId: string | null;
  /** Time left to the stop, or null while the target is not reachable yet. */
  remainingMs: number | null;
}

export const useSleepStore = create<SleepState>(() => ({ plan: null, trackId: null, remainingMs: null }));

let interval: ReturnType<typeof setInterval> | null = null;
let lastFade = 1;

function applyFade(multiplier: number): void {
  if (multiplier === lastFade) return;
  lastFade = multiplier;
  soundActions.setSleepLevel(multiplier);
}

function disarm(): void {
  if (interval !== null) clearInterval(interval);
  interval = null;
  useSleepStore.setState({ plan: null, trackId: null, remainingMs: null });
}

function finish(): void {
  disarm();
  soundActions.pauseForSleep();
  setTimeout(() => applyFade(1), FADE_RESET_DELAY_MS);
}

function tick(): void {
  const { plan, trackId } = useSleepStore.getState();
  if (!plan) return;
  const player = usePlayerStore.getState();
  // A manual skip moves an end-of-track timer to the new track
  const currentId = player.currentTrack?.id ?? null;
  if (plan.target.kind === "end_of_track" && currentId !== trackId) useSleepStore.setState({ trackId: currentId });

  const durationMs = player.durationMs > 0 ? player.durationMs : (player.currentTrack?.durationMs ?? 0);
  // Media time: at a playback rate below 1 the real fade lasts longer than 30 s
  const trackMsLeft = durationMs > 0 ? Math.max(0, durationMs - player.positionMs) : Infinity;
  const isLast = player.currentIndex >= player.queue.length - 1;
  const msLeft = msUntilSleep(plan, Date.now(), trackMsLeft, isLast);

  // A track end lands between ticks, so stop one tick early instead of letting the next track start
  const stopAt = plan.target.kind === "minutes" ? 0 : TICK_MS;
  if (msLeft !== null && msLeft <= stopAt) return finish();

  applyFade(msLeft === null ? 1 : sleepVolume(msLeft));
  useSleepStore.setState({ remainingMs: msLeft !== null && Number.isFinite(msLeft) ? msLeft : null });
}

export function armSleepTimer(target: SleepTarget): void {
  const player = usePlayerStore.getState();
  useSleepStore.setState({ plan: planSleep(target, Date.now()), trackId: player.currentTrack?.id ?? null });
  if (interval === null) interval = setInterval(tick, TICK_MS);
  tick();
}

export function cancelSleepTimer(): void {
  disarm();
  applyFade(1);
}

/** mm:ss, rounded up so the display reaches 00:00 only when the timer fires. */
export function formatSleepClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function useSleepTimer() {
  const plan = useSleepStore((state) => state.plan);
  const remainingMs = useSleepStore((state) => state.remainingMs);
  return { target: plan?.target ?? null, remainingMs, isFading: remainingMs !== null && remainingMs < SLEEP_FADE_MS };
}
