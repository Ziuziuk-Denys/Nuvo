import { useEffect, useSyncExternalStore } from "react";
import { CORE_BASE_URL } from "@/engine/boot";
import { lyrics } from "@/lyrics";
import { usePlayerStore } from "./player";

export type WordTimingModel = "whisper-base" | "whisper-small";

export interface WordTimingJob {
  trackId: string;
  model: WordTimingModel;
  state: "waiting" | "running" | "done" | "failed";
  progress: number;
  code?: string;
}

export interface WordTimingView {
  enabled: boolean;
  models: WordTimingModel[];
  job?: WordTimingJob;
}

export const POLL_MS = 500;

export const MODEL_CHOICES = ["auto", "light", "full"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

const CHOICE_KEY = "nuvo.lyrics.model";
const STRONG_CORES = 8;
// Chromium caps its measured bandwidth at 10 Mbps, so only the cap reads as fast: 264 MB in under four minutes
const FAST_MBPS = 10;

function readChoice(): ModelChoice {
  try {
    const stored = localStorage.getItem(CHOICE_KEY);
    return MODEL_CHOICES.includes(stored as ModelChoice) ? (stored as ModelChoice) : "auto";
  } catch {
    return "auto";
  }
}

let choice = readChoice();
const choiceListeners = new Set<() => void>();

export function setModelChoice(next: ModelChoice): void {
  choice = next;
  try {
    localStorage.setItem(CHOICE_KEY, next);
  } catch {
    // storage blocked: the choice lasts this session
  }
  choiceListeners.forEach((listener) => listener());
}

export function useModelChoice(): ModelChoice {
  return useSyncExternalStore(
    (listener) => {
      choiceListeners.add(listener);
      return () => choiceListeners.delete(listener);
    },
    () => choice,
  );
}

export function prefersFullModel(installed: readonly WordTimingModel[]): boolean {
  if (choice !== "auto") return choice === "full";
  if ((navigator.hardwareConcurrency ?? 0) < STRONG_CORES) return false;
  const downlink = (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink ?? 0;
  return installed.includes("whisper-small") || downlink >= FAST_MBPS;
}

export function timingModel(installed: readonly WordTimingModel[]): WordTimingModel {
  return prefersFullModel(installed) ? "whisper-small" : "whisper-base";
}

export function writingModel(): WordTimingModel {
  return choice === "light" ? "whisper-base" : "whisper-small";
}

/** Versions the daemon timed on this computer are named after their model. */
export function isLocalTiming(provider: string | null): boolean {
  return provider === "whisper-base" || provider === "whisper-small";
}

export function isRunning(job: WordTimingJob | undefined, trackId: string | null): job is WordTimingJob {
  return job !== undefined && job.trackId === trackId && (job.state === "waiting" || job.state === "running");
}

let view: WordTimingView | null = null;
const listeners = new Set<() => void>();
let poll: ReturnType<typeof setTimeout> | null = null;
/** Tracks already asked for in this session, so a failure is not retried on every render. */
const asked = new Set<string>();

function publish(next: WordTimingView | null): void {
  const finished = view?.job && isRunning(view.job, view.job.trackId) && next?.job?.trackId === view.job.trackId && next.job.state === "done";
  view = next;
  listeners.forEach((listener) => listener());
  if (finished) void reloadLyrics();
  if (poll) clearTimeout(poll);
  poll = next && isRunning(next.job, next.job?.trackId ?? null) ? setTimeout(() => void refresh(), POLL_MS) : null;
}

export async function request(method: string, path: string, body?: unknown): Promise<Response | null> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  return fetch(`${CORE_BASE_URL}${path}`, init).catch(() => null);
}

export async function reloadLyrics(): Promise<void> {
  const track = usePlayerStore.getState().currentTrack;
  if (!track) return;
  try {
    await lyrics().reload(track);
  } catch {
    // the lyrics engine is not running in this window
  }
}

export async function refresh(): Promise<void> {
  const response = await request("GET", "/v1/lyrics/word-timing");
  if (response?.ok) publish((await response.json()) as WordTimingView);
}

export async function setWordTiming(enabled: boolean): Promise<void> {
  const response = await request("PUT", "/v1/lyrics/word-timing", { enabled });
  if (!response?.ok) return;
  publish((await response.json()) as WordTimingView);
  await reloadLyrics();
}

export async function timeWords(trackId: string, best = prefersFullModel(view?.models ?? [])): Promise<void> {
  asked.add(trackId);
  const response = await request("POST", `/v1/tracks/${encodeURIComponent(trackId)}/lyrics/word-timing`, { best });
  if (response?.ok) await refresh();
}

export async function cancelWordTiming(trackId: string): Promise<void> {
  await request("DELETE", `/v1/tracks/${encodeURIComponent(trackId)}/lyrics/word-timing`);
  await refresh();
}

export function useWordTiming(): WordTimingView | null {
  useEffect(() => {
    if (view === null) void refresh();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
  );
}

/** Times the shown song by itself once word timing is on and the song has only line timing. */
export function useAutoWordTiming(trackId: string | null, lineOnly: boolean): void {
  const enabled = useWordTiming()?.enabled === true;
  useEffect(() => {
    if (enabled && lineOnly && trackId && !asked.has(trackId)) void timeWords(trackId);
  }, [enabled, lineOnly, trackId]);
}

export function resetForTests(): void {
  view = null;
  choice = readChoice();
  asked.clear();
  if (poll) clearTimeout(poll);
  poll = null;
  listeners.clear();
}
