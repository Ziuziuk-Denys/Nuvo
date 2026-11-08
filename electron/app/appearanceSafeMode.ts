/** Appearance safe mode (customization 6.1): the flag lives in main-settings.json, readable while the library is locked. */

export interface AppearanceFlags {
  safe: boolean;
  /** Page loads in a row that crashed or failed before the renderer reported its look applied. */
  failedStarts: number;
}

export const DEFAULT_APPEARANCE: AppearanceFlags = { safe: false, failedStarts: 0 };
/** Provisional owner default: two crashed starts in a row switch custom appearance off. */
export const FAILED_STARTS_FOR_SAFE = 2;
export const SHIFT_WINDOW_MS = 2000;
/** From `appearance:applying` to `appearance:ready`: longer means the renderer hung while applying the look. */
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

/** One instance per main window. Each page load is either reported ready or counted once as failed. */
export class StartWatch {
  private decided = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly flags: FlagStore) {}

  loadStarted(): void {
    this.decided = false;
    this.disarm();
  }

  /** `appearance:applying`: the renderer read the saved look and starts applying it; silence for too long is a hang. */
  applying(): void {
    if (this.decided) return;
    this.disarm();
    this.watchdog = setTimeout(() => this.failed(), APPLY_TIMEOUT_MS);
  }

  private disarm(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /** `appearance:ready` from the renderer. */
  ready(): void {
    if (this.decided) return;
    this.decided = true;
    this.disarm();
    const current = this.flags.get();
    if (current.failedStarts !== 0) this.flags.set({ ...current, failedStarts: 0 });
  }

  /** render-process-gone (not a clean exit) or did-fail-load of the main frame. */
  failed(): void {
    if (this.decided) return;
    this.decided = true;
    this.disarm();
    const current = this.flags.get();
    const failedStarts = current.failedStarts + 1;
    this.flags.set({ safe: current.safe || failedStarts >= FAILED_STARTS_FOR_SAFE, failedStarts });
  }

  /** Shift at start, the process flag or the tray entry. */
  forceSafe(): void {
    const current = this.flags.get();
    if (!current.safe) this.flags.set({ ...current, safe: true });
  }
}

/** Shift pressed within the first two seconds of the window. */
export function isShiftAtStart(input: { type: string; key: string }, msSinceWindow: number): boolean {
  return input.type === "keyDown" && input.key === "Shift" && msSinceWindow <= SHIFT_WINDOW_MS;
}
