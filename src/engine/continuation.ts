import type { RankReason, Track } from "./types";

export const REFILL_DEBOUNCE_MS = 400;
export const BATCH_SIZE = 10;
export const MAX_SEED_IDS = 200;
export const MAX_CONTEXT_LENGTH = 300;

export interface ContinuationRequest {
  context: string;
  seeds: string[];
  recent: string[];
  sessionId: string | null;
  limit: number;
}

export type Suggested = Track & { reason?: RankReason };

export interface ContinuationPort {
  next(request: ContinuationRequest): Promise<Suggested[]>;
}

export class Refill {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly port: ContinuationPort,
    private readonly build: () => ContinuationRequest & { accept(tracks: Suggested[]): void },
    private readonly log: (message: string, error: unknown) => void,
  ) {}

  get busy(): boolean {
    return this.running !== null;
  }

  trigger(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.now();
    }, REFILL_DEBOUNCE_MS);
  }

  now(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) return this.running;
    const request = this.build();
    const { accept, ...body } = request;
    this.running = this.port
      .next({ ...body, context: body.context.slice(0, MAX_CONTEXT_LENGTH) })
      .then(accept, (error: unknown) => this.log("continuation failed", error))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
