/** Supervises the hidden worker window. Electron-free so it runs under fake windows. */
import { MinuteLimit, validateJob, type Job, type WorkerOp } from "./validate";

export const START_TIMEOUT_MS = 20_000;
/** Close after 3 minutes without requests and without app audio. */
export const IDLE_CLOSE_MS = 180_000;
const IDLE_CHECK_MS = 15_000;
export const MAX_PENDING = 64;
export const CONTENT_TOKENS_PER_MINUTE = 60;
const MAX_ERROR_CHARS = 500;
const MAX_ANSWER_CHARS = 4096;
export const OP_TIMEOUT_MS: Record<WorkerOp, number> = {
  "content-token": 20_000,
  "tv-identity": 30_000,
  "player-transform": 45_000,
};

export interface WorkerWindow {
  readonly contentsId: number;
  send(channel: "nuvo-yt:job", job: { id: number; op: WorkerOp; args: unknown }): void;
  destroy(): void;
  onClosed(listener: () => void): void;
  onLoadFailed(listener: (reason: string) => void): void;
}

export class WorkerError extends Error {
  constructor(
    readonly code: "worker-start" | "worker-closed" | "worker-timeout" | "worker-busy" | "bad-answer" | "bad-input",
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "WorkerError";
  }
}

interface Pending {
  job: Job;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_ANSWER_CHARS;

const textsOf = (value: unknown, length: number): boolean => Array.isArray(value) && value.length === length && value.every(isText);

/** Answer shapes the renderer bridge reads (`src/youtube/playback/worker.ts`); anything else never reaches a caller. */
function answerMatches(job: Job, value: unknown): boolean {
  if (job.op === "content-token") return isText(value) && value.length > 0;
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const stamped = typeof record.signatureTimestamp === "number" && Number.isFinite(record.signatureTimestamp);
  if (job.op === "tv-identity") return stamped && ["token", "livingRoomId", "visitor", "version", "scriptId"].every((key) => isText(record[key]));
  return stamped && textsOf(record.n, (job.args.n as string[]).length) && textsOf(record.sig, (job.args.sig as string[]).length);
}

export class WorkerHost {
  private window: WorkerWindow | null = null;
  private ready: Promise<void> | null = null;
  private markReady: (() => void) | null = null;
  /** The current window has said hello and is not closed. */
  private open = false;
  private failStart: ((error: WorkerError) => void) | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    private readonly createWindow: () => WorkerWindow,
    private readonly log: (message: string) => void = () => undefined,
    private readonly tokenLimit = new MinuteLimit(CONTENT_TOKENS_PER_MINUTE),
    /** While true (a queue is playing) the idle close waits another round. */
    private readonly keepOpen: () => boolean = () => false,
  ) {}

  get contentsId(): number | null {
    return this.window?.contentsId ?? null;
  }

  async request(op: unknown, args: unknown): Promise<unknown> {
    // Readiness is a question, not a job: it never starts the window or arms the idle timer.
    if (op === "ready") return this.open;
    const job = validateJob(op, args);
    if (!job) throw new WorkerError("bad-input");
    if (this.pending.size >= MAX_PENDING) throw new WorkerError("worker-busy", "too many requests");
    if (job.op === "content-token" && !this.tokenLimit.take()) throw new WorkerError("worker-busy", "rate limit");
    this.cancelIdle();
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { job, resolve, reject, timer: null }));
    // Settled by timers or close while start() is still awaited; the caller sees it below.
    result.catch(() => undefined);
    try {
      await this.start();
    } catch (error) {
      this.settle(id, undefined, error);
      return result;
    }
    const entry = this.pending.get(id);
    if (entry && this.window) {
      // The op timeout runs from the moment the job is sent; the start has its own 20 s.
      // A timed-out worker is not trusted any more: restart it on the next request.
      entry.timer = setTimeout(() => this.close("worker-timeout", job.op), OP_TIMEOUT_MS[job.op]);
      this.window.send("nuvo-yt:job", { id, op: job.op, args: job.args });
    }
    return result;
  }

  /** The worker document is ready; only the current window counts. */
  hello(contentsId: number): void {
    if (contentsId !== this.window?.contentsId) return;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.open = true;
    this.markReady?.();
    this.markReady = null;
    this.failStart = null;
  }

  /** A job answer; answers from any other webContents are ignored. */
  done(contentsId: number, message: unknown): void {
    if (contentsId !== this.window?.contentsId || typeof message !== "object" || message === null) return;
    const { id, value, error } = message as {
      id?: unknown;
      value?: unknown;
      error?: unknown;
    };
    if (typeof id !== "number") return;
    if (error !== undefined) {
      this.settle(id, undefined, new Error(String(error).slice(0, MAX_ERROR_CHARS)));
      return;
    }
    const entry = this.pending.get(id);
    if (entry && !answerMatches(entry.job, value)) this.settle(id, undefined, new WorkerError("bad-answer", entry.job.op));
    else this.settle(id, value, undefined);
  }

  dispose(): void {
    this.close("worker-closed");
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const window = this.createWindow();
    this.window = window;
    this.ready = new Promise<void>((resolve, reject) => {
      this.markReady = resolve;
      this.failStart = reject;
    });
    this.ready.catch(() => undefined);
    this.startTimer = setTimeout(() => this.abortStart(new WorkerError("worker-start", "no ready signal")), START_TIMEOUT_MS);
    window.onLoadFailed((reason) => this.abortStart(new WorkerError("worker-start", reason)));
    window.onClosed(() => {
      if (this.window === window) this.close("worker-closed");
    });
    return this.ready;
  }

  private abortStart(error: WorkerError): void {
    if (!this.failStart) return;
    this.log(`[youtube] worker failed to start: ${error.message}`);
    const fail = this.failStart;
    this.teardown();
    fail(error);
  }

  private settle(id: number, value: unknown, error: unknown): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (error === undefined) entry.resolve(value);
    else entry.reject(error);
    if (this.pending.size === 0 && this.window) this.armIdle();
  }

  private armIdle(): void {
    this.cancelIdle();
    let quietSince = Date.now();
    const check = () => {
      if (this.keepOpen()) quietSince = Date.now();
      if (Date.now() - quietSince >= IDLE_CLOSE_MS) this.close("worker-closed");
      else this.idleTimer = setTimeout(check, IDLE_CHECK_MS);
    };
    this.idleTimer = setTimeout(check, IDLE_CHECK_MS);
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private close(code: "worker-closed" | "worker-timeout", detail?: string): void {
    const pending = [...this.pending.keys()];
    const failStart = this.failStart;
    this.teardown();
    failStart?.(new WorkerError(code, detail));
    for (const id of pending) this.settle(id, undefined, new WorkerError(code, detail));
  }

  private teardown(): void {
    const window = this.window;
    this.window = null;
    this.open = false;
    this.ready = null;
    this.markReady = null;
    this.failStart = null;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.cancelIdle();
    window?.destroy();
  }
}
