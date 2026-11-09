export type SleepTarget = { kind: "minutes"; minutes: number } | { kind: "end_of_track" } | { kind: "end_of_queue" };

export const SLEEP_FADE_MS = 30_000;

export interface SleepPlan {
  stopAt: number | null;
  target: SleepTarget;
}

export function planSleep(target: SleepTarget, now: number): SleepPlan {
  return { target, stopAt: target.kind === "minutes" ? now + target.minutes * 60_000 : null };
}

export function sleepVolume(msLeft: number): number {
  if (msLeft >= SLEEP_FADE_MS) return 1;
  return Math.max(0, msLeft / SLEEP_FADE_MS);
}

export function msUntilSleep(plan: SleepPlan, now: number, trackMsLeft: number, isLastInQueue: boolean): number | null {
  switch (plan.target.kind) {
    case "minutes":
      return Math.max(0, (plan.stopAt ?? now) - now);
    case "end_of_track":
      return trackMsLeft;
    case "end_of_queue":
      return isLastInQueue ? trackMsLeft : null;
  }
}
