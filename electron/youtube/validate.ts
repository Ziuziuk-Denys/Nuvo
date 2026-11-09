export type WorkerOp = "content-token" | "tv-identity" | "player-transform";

export interface Job {
  op: WorkerOp;
  args: Record<string, unknown>;
}

const IDENTIFIER = /^[A-Za-z0-9_=-]{1,1024}$/;
const PLAYER_ID = /^[A-Za-z0-9_-]{4,32}$/;
const N_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
/** Scrambled signatures are longer and may carry `=` and `.`. */
const SIG_VALUE = /^[A-Za-z0-9_=.-]{1,256}$/;
/** Matches the worker's own limit in `worker/transform.ts`. */
export const MAX_VALUES = 16;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const listOf = (value: unknown, pattern: RegExp): string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_VALUES) return null;
  return value.every((item) => typeof item === "string" && pattern.test(item)) ? (value as string[]) : null;
};

export function validateJob(op: unknown, args: unknown): Job | null {
  if (op === "content-token") {
    if (!isRecord(args) || typeof args.identifier !== "string" || !IDENTIFIER.test(args.identifier)) return null;
    return { op, args: { identifier: args.identifier } };
  }
  if (op === "tv-identity") {
    if (args !== undefined && !(isRecord(args) && Object.keys(args).length === 0)) return null;
    return { op, args: {} };
  }
  if (op === "player-transform") {
    if (!isRecord(args) || typeof args.playerId !== "string" || !PLAYER_ID.test(args.playerId)) return null;
    const n = listOf(args.n, N_VALUE);
    const sig = listOf(args.sig, SIG_VALUE);
    if (!n || !sig) return null;
    return { op, args: { playerId: args.playerId, n, sig } };
  }
  return null;
}

export const INTERPRETER_HOSTS = new Set(["www.google.com", "www.gstatic.com"]);

export function interpreterUrlAllowed(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && INTERPRETER_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export class MinuteLimit {
  private stamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const now = this.now();
    this.stamps = this.stamps.filter((stamp) => now - stamp < 60_000);
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(now);
    return true;
  }
}
