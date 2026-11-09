export interface AppearanceFlags {
  safe: boolean;
  failedStarts: number;
}

export const DEFAULT_APPEARANCE: AppearanceFlags = { safe: false, failedStarts: 0 };
export const FAILED_STARTS_FOR_SAFE = 2;
export const SHIFT_WINDOW_MS = 2000;
export const APPLY_TIMEOUT_MS = 20000;
export const SAFE_FLAG = "--safe-appearance";

export interface FlagStore {
  get(): AppearanceFlags;
  set(next: AppearanceFlags): void;
}

/** did-fail-load: ERR_ABORTED (-3) is a navigation or reload cutting the load short, and sub-frames are not the start. */
export function countsAsFailedStart(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== -3;
}

export class StartWatch {
  private decided = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly flags: FlagStore) {}

  loadStarted(): void {
    this.decided = false;
    this.disarm();
  }

  applying(): void {
    if (this.decided) return;
    this.disarm();
    this.watchdog = setTimeout(() => this.failed(), APPLY_TIMEOUT_MS);
  }

  private disarm(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  ready(): void {
    if (this.decided) return;
    this.decided = true;
    this.disarm();
    const current = this.flags.get();
    if (current.failedStarts !== 0) this.flags.set({ ...current, failedStarts: 0 });
  }

  failed(): void {
    if (this.decided) return;
    this.decided = true;
    this.disarm();
    const current = this.flags.get();
    const failedStarts = current.failedStarts + 1;
    this.flags.set({ safe: current.safe || failedStarts >= FAILED_STARTS_FOR_SAFE, failedStarts });
  }

  forceSafe(): void {
    const current = this.flags.get();
    if (!current.safe) this.flags.set({ ...current, safe: true });
  }
}

export function isShiftAtStart(input: { type: string; key: string }, msSinceWindow: number): boolean {
  return input.type === "keyDown" && input.key === "Shift" && msSinceWindow <= SHIFT_WINDOW_MS;
}
