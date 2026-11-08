/** Recording a new binding: Escape cancels, held modifiers show, a key commits or is refused with a reason. */
import { acceleratorFromEvent, heldModifiers, isComposing, type KeyLike } from "./accelerator";
import type { GlobalSync } from "./globalSync";
import type { BindingResult, CommandRegistry, Scope } from "./registry";

/** How long a refusal stays on screen. */
export const REJECTION_MS = 2500;

export type RecorderState =
  { kind: "idle" } | { kind: "recording"; id: string; scope: Scope; held: string[]; rejection: Extract<BindingResult, { ok: false }> | null };

export class Recorder {
  private current: RecorderState = { kind: "idle" };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly registry: CommandRegistry;
  private readonly globals: GlobalSync;

  constructor(registry: CommandRegistry, globals: GlobalSync) {
    this.registry = registry;
    this.globals = globals;
  }

  get state(): RecorderState {
    return this.current;
  }

  get recording(): boolean {
    return this.current.kind === "recording";
  }

  /** In-app recording keeps main's grabs; a global one releases them so the keys reach the window. */
  start(id: string, scope: Scope): void {
    this.stop();
    this.current = { kind: "recording", id, scope, held: [], rejection: null };
    if (scope === "global") this.globals.release();
    this.emit();
  }

  /** Cancel or finish: normal shortcuts work again and a released global list is sent again. */
  stop(): void {
    if (this.current.kind !== "recording") return;
    const { scope } = this.current;
    this.current = { kind: "idle" };
    this.clearTimer();
    if (scope === "global") this.globals.restore();
    this.emit();
  }

  key(event: KeyLike): void {
    const state = this.current;
    if (state.kind !== "recording" || isComposing(event)) return;
    if (event.key === "Escape") {
      this.stop();
      return;
    }
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) {
      this.current = { ...state, held: heldModifiers(event) };
      this.emit();
      return;
    }
    const result = this.registry.setBinding(state.id, state.scope, accelerator);
    if (result.ok) {
      this.stop();
      return;
    }
    this.current = { ...state, held: [], rejection: result };
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.current.kind !== "recording") return;
      this.current = { ...this.current, rejection: null };
      this.emit();
    }, REJECTION_MS);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
