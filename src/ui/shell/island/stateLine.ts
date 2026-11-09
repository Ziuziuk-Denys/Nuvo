export interface StateLineInput {
  offline: boolean;
  sleepRemainingMs: number | null;
  playbackContext: string | null;
  queueTitles: string[];
  currentIndex: number;
  autoplayFrom: number | null;
  reason?: string | null;
  notice?: string | null;
  downloads?: { done: number; total: number } | null;
}

export type StateLine =
  | { kind: "notice"; text: string }
  | { kind: "offline" }
  | { kind: "sleep"; clock: string }
  | { kind: "downloads"; done: number; total: number }
  | { kind: "radio-queue" }
  | { kind: "reason"; text: string }
  | { kind: "radio-seed"; seed: string };

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export function stateLine(input: StateLineInput): StateLine | null {
  if (input.notice) return { kind: "notice", text: input.notice };
  if (input.offline) return { kind: "offline" };
  if (input.sleepRemainingMs !== null && input.sleepRemainingMs > 0) {
    return { kind: "sleep", clock: formatClock(input.sleepRemainingMs) };
  }
  if (input.downloads && input.downloads.total > 0) return { kind: "downloads", done: input.downloads.done, total: input.downloads.total };
  if (input.reason) return { kind: "reason", text: input.reason };
  if (input.playbackContext?.startsWith("radio:")) {
    const seed = input.queueTitles[0];
    return seed ? { kind: "radio-seed", seed } : { kind: "radio-queue" };
  }
  if (input.autoplayFrom !== null && input.currentIndex >= input.autoplayFrom) {
    const single = input.autoplayFrom === 1 ? input.queueTitles[0] : undefined;
    return single ? { kind: "radio-seed", seed: single } : { kind: "radio-queue" };
  }
  return null;
}
