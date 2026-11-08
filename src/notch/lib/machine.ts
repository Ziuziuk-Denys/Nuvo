import type { IslandMode } from "./geometry";

export const HOVER_EXIT_MS = 200;
export const EXPAND_DWELL_MS = 350;
export const PULSE_MS = 2400;

export type ExpandTrigger = "hover" | "click";

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Pointer and playback driven island mode. Kept outside React so timing is testable with fake
 * timers and the component only renders `mode`.
 */
export class IslandMachine {
  private hasTrack = false;
  private inside = false;
  private expanded = false;
  private pulsing = false;
  private holding = false;
  private disposed = false;
  private dwell: unknown = null;
  private exit: unknown = null;
  private pulse: unknown = null;

  constructor(
    private readonly onChange: (mode: IslandMode) => void,
    private trigger: ExpandTrigger = "hover",
    private readonly timers: Timers = realTimers,
  ) {}

  get mode(): IslandMode {
    if (this.expanded) return "expanded";
    if (this.inside || this.pulsing) return "hover";
    return this.hasTrack ? "live" : "idle";
  }

  setTrigger(trigger: ExpandTrigger) {
    if (this.disposed) return;
    this.trigger = trigger;
    if (trigger === "click") this.cancel("dwell");
  }

  setTrack(hasTrack: boolean, changed: boolean) {
    if (this.disposed) return;
    this.update(() => {
      this.hasTrack = hasTrack;
      if (!hasTrack) {
        this.expanded = false;
        this.inside = false;
        this.cancel("dwell");
        this.pulsing = false;
        this.cancel("pulse");
      }
      if (hasTrack && changed && !this.inside && !this.expanded) {
        this.pulsing = true;
        this.restart("pulse", PULSE_MS, () => this.update(() => (this.pulsing = false)));
      }
    });
  }

  pointerEnter() {
    if (this.disposed) return;
    this.update(() => {
      this.inside = true;
      this.cancel("exit");
      if (this.trigger === "hover" && this.hasTrack && !this.expanded) {
        this.restart("dwell", EXPAND_DWELL_MS, () => this.update(() => (this.expanded = true)));
      }
    });
  }

  pointerLeave() {
    if (this.disposed) return;
    this.update(() => {
      this.cancel("dwell");
      this.restart("exit", HOVER_EXIT_MS, () =>
        this.update(() => {
          this.inside = false;
          if (!this.holding) this.expanded = false;
        }),
      );
    });
  }

  click() {
    if (this.disposed) return;
    this.update(() => {
      if (this.hasTrack) this.expanded = true;
    });
  }

  /** While the scrubber is dragged the island must not collapse. */
  hold(active: boolean) {
    if (this.disposed) return;
    this.update(() => {
      this.holding = active;
      if (!active && !this.inside) this.expanded = false;
    });
  }

  dispose() {
    this.disposed = true;
    this.cancel("dwell");
    this.cancel("exit");
    this.cancel("pulse");
    this.hasTrack = false;
    this.inside = false;
    this.expanded = false;
    this.pulsing = false;
    this.holding = false;
  }

  private update(change: () => void) {
    const before = this.mode;
    change();
    if (this.mode !== before) this.onChange(this.mode);
  }

  private cancel(name: "dwell" | "exit" | "pulse") {
    if (this[name] !== null) this.timers.clear(this[name]);
    this[name] = null;
  }

  private restart(name: "dwell" | "exit" | "pulse", ms: number, fn: () => void) {
    this.cancel(name);
    this[name] = this.timers.set(() => {
      this[name] = null;
      fn();
    }, ms);
  }
}
