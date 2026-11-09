import type { Cause, FallbackInfo } from "../types";

export const FALLBACK_MAX_ALTERNATIVES = 2;
export const FALLBACK_BUDGET_MS = 15_000;
export const SAME_POSITION_TOLERANCE_MS = 3000;
export const APPROVED_SCORE = 75;

export type TriggerCause = FallbackInfo["cause"];

export function isFallbackTrigger(cause: TriggerCause): boolean {
  return (
    cause === "unavailable" ||
    cause === "drm" ||
    cause === "sign_in_required" ||
    cause === "blocked" ||
    cause === "timeout" ||
    cause === "media_error" ||
    cause === "http_403" ||
    cause === "stall"
  );
}

export function displayCause(cause: TriggerCause): Cause {
  if (cause === "http_403") return "blocked";
  if (cause === "stall") return "timeout";
  if (cause === "media_error") return "unavailable";
  return cause;
}

export function isLastingReason(reason: string, bestQuality: boolean): boolean {
  if (reason === "pinned" || reason === "unavailable" || reason === "drm" || reason === "sign_in_required") return true;
  return bestQuality && reason === "bitrate";
}

export interface Format {
  codec: string;
  bitrateKbps: number;
}

const CODEC_RANK: Record<string, number> = { opus: 3, aac: 2, mp4a: 2, mp3: 1 };

function codecRank(codec: string): number {
  const key = codec.toLowerCase().split(".")[0];
  return CODEC_RANK[key] ?? 0;
}

export function betterFormat(a: Format, b: Format): boolean {
  if (a.bitrateKbps !== b.bitrateKbps) return a.bitrateKbps > b.bitrateKbps;
  return codecRank(a.codec) > codecRank(b.codec);
}

export function cacheGoodEnough(cachedKbps: number | null, bestReachableKbps: number | null): boolean {
  if (cachedKbps === null || bestReachableKbps === null) return true;
  return cachedKbps >= bestReachableKbps;
}

export function alternativeStart(failedAtMs: number, primaryDurationMs: number, alternativeDurationMs: number): { startAtMs: number; restarted: boolean } {
  if (failedAtMs <= 0) return { startAtMs: 0, restarted: false };
  if (Math.abs(primaryDurationMs - alternativeDurationMs) <= SAME_POSITION_TOLERANCE_MS) return { startAtMs: failedAtMs, restarted: false };
  return { startAtMs: 0, restarted: true };
}

export class FallbackBudget {
  private used = 0;
  private readonly deadline: number;

  constructor(private readonly now: () => number) {
    this.deadline = now() + FALLBACK_BUDGET_MS;
  }

  get exhausted(): boolean {
    return this.used >= FALLBACK_MAX_ALTERNATIVES || this.now() >= this.deadline;
  }

  get msLeft(): number {
    return Math.max(0, this.deadline - this.now());
  }

  spend(): void {
    this.used += 1;
  }
}

export function kbpsOf(bitrateBps: number): number {
  return Math.round(bitrateBps / 1000);
}
