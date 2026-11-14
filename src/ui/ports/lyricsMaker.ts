import { useEffect, useSyncExternalStore } from "react";
import {
  POLL_MS,
  cancelWordTiming,
  isRunning,
  reloadLyrics,
  request,
  setWordTiming,
  timeWords,
  type WordTimingJob,
  type WordTimingModel,
  type WordTimingView,
} from "./wordTiming";

export type MadeSource = "synced" | "aligned" | "transcribed";

export interface MadeView {
  models: WordTimingModel[];
  job?: WordTimingJob & { source: MadeSource };
}

// rounded from the pinned sizes in bytes
export const MODEL_MB: Record<string, number> = { "whisper-base": 82, "whisper-small": 264 };

export type LyricsHave = "none" | "plain" | "lines" | "words";

export type MakerTask = "write" | "time";

export type MakerOffer =
  | { kind: "working"; task: MakerTask; phase: "download" | "prepare" | "running"; percent: number; model: string }
  | { kind: "failed"; task: MakerTask; code: string }
  | { kind: "offer"; task: MakerTask; downloadMb: number | null }
  | { kind: "none" };

let made: MadeView | null = null;
const listeners = new Set<() => void>();
let poll: ReturnType<typeof setTimeout> | null = null;

function publish(next: MadeView | null): void {
  const finished = made?.job && isRunning(made.job, made.job.trackId) && next?.job?.trackId === made.job.trackId && next.job.state === "done";
  made = next;
  listeners.forEach((listener) => listener());
  if (finished) void reloadLyrics();
  if (poll) clearTimeout(poll);
  poll = next && isRunning(next.job, next.job?.trackId ?? null) ? setTimeout(() => void refreshMade(), POLL_MS) : null;
}

export async function refreshMade(): Promise<void> {
  const response = await request("GET", "/v1/lyrics/made");
  if (response?.ok) publish((await response.json()) as MadeView);
}

export function useMadeLyrics(): MadeView | null {
  useEffect(() => {
    if (made === null) void refreshMade();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => made,
  );
}

export function madeBy(source: string | undefined): "written" | "timed" | null {
  if (source === "transcribed") return "written";
  return source === "synced" || source === "aligned" ? "timed" : null;
}

// plain lyrics and songs with none are made on request; synced lines go through the word timing switch
function madeSource(have: LyricsHave): MadeSource | null {
  if (have === "none") return "transcribed";
  return have === "plain" ? "aligned" : null;
}

export function makerOffer(timing: WordTimingView | null, madeView: MadeView | null, trackId: string | null, have: LyricsHave): MakerOffer {
  const source = madeSource(have);
  const view = source ? madeView : timing;
  if (!view || !trackId) return { kind: "none" };
  const task: MakerTask = have === "none" ? "write" : "time";
  const job = view.job?.trackId === trackId && (!source || madeView?.job?.source === source) ? view.job : undefined;
  if (job?.state === "waiting" || job?.state === "running") {
    const phase = job.state === "running" ? "running" : view.models.includes(job.model) ? "prepare" : "download";
    return { kind: "working", task, phase, percent: Math.round(job.progress * 100), model: job.model };
  }
  if (have === "words") return { kind: "none" };
  const switchedOn = timing?.enabled === true;
  if ((source || switchedOn) && job?.state === "failed") return { kind: "failed", task, code: job.code ?? "failed" };
  // with the switch on, synced lines are timed by themselves
  if (!source && switchedOn) return { kind: "none" };
  const model = source === "transcribed" ? "whisper-small" : "whisper-base";
  return { kind: "offer", task, downloadMb: view.models.includes(model) ? null : MODEL_MB[model] };
}

export async function makeLyrics(timing: WordTimingView | null, trackId: string, have: LyricsHave): Promise<void> {
  const source = madeSource(have);
  if (!source) {
    if (!timing?.enabled) await setWordTiming(true);
    return timeWords(trackId);
  }
  const response = await request("POST", `/v1/tracks/${encodeURIComponent(trackId)}/lyrics/made`, { source });
  if (response?.ok) await refreshMade();
}

export async function cancelMaking(trackId: string, have: LyricsHave): Promise<void> {
  if (!madeSource(have)) return cancelWordTiming(trackId);
  await request("DELETE", `/v1/tracks/${encodeURIComponent(trackId)}/lyrics/made/job`);
  await refreshMade();
}

export function resetMadeForTests(): void {
  made = null;
  if (poll) clearTimeout(poll);
  poll = null;
  listeners.clear();
}
