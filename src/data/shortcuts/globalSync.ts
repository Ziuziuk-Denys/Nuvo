/** System-wide bindings: the full list goes to main when it changes, and each binding keeps main's answer. */
import type { CommandRegistry } from "./registry";

export interface GlobalBinding {
  commandId: string;
  accelerator: string;
}

export interface GlobalResult {
  commandId: string;
  ok: boolean;
  reason?: string;
}

export interface GlobalShell {
  setGlobalShortcuts(bindings: GlobalBinding[]): Promise<GlobalResult[]>;
}

export type GlobalStatus = "pending" | "active" | "taken" | "invalid" | "unsupported";

/** Main refuses more. */
export const MAX_GLOBAL_BINDINGS = 32;

function statusFor(reason: string | undefined): GlobalStatus {
  return reason === "taken" || reason === "unsupported" ? reason : "invalid";
}

export class GlobalSync {
  private readonly registry: CommandRegistry;
  private readonly shell: GlobalShell | null;
  private readonly statuses = new Map<string, GlobalStatus>();
  private readonly listeners = new Set<() => void>();
  private lastSent: string | null = null;
  private started = false;
  private released = false;

  constructor(registry: CommandRegistry, shell: GlobalShell | null) {
    this.registry = registry;
    this.shell = shell;
    registry.subscribe(() => this.sync());
  }

  /** The effective global bindings of commands that may be global. */
  bindings(): GlobalBinding[] {
    return this.wanted().slice(0, MAX_GLOBAL_BINDINGS);
  }

  private wanted(): GlobalBinding[] {
    return this.registry.list().flatMap((command) => (command.global && command.globalAllowed ? [{ commandId: command.id, accelerator: command.global }] : []));
  }

  /** Starts sending; before this nothing goes to main, so start-up sends one list, not one per registration. */
  begin(): void {
    this.started = true;
    this.sync();
  }

  /** Sends the list when it changed since the last send; unchanged lists are not sent again (a portal may ask the user each time). */
  sync(): void {
    if (!this.shell || !this.started || this.released) return;
    const bindings = this.bindings();
    const key = JSON.stringify(bindings);
    if (key !== this.lastSent) this.send(bindings, key);
  }

  /** Sends again while an answer is missing (main was busy); the app calls this on window focus. */
  retry(): void {
    if (![...this.statuses.values()].includes("pending")) return;
    this.lastSent = null;
    this.sync();
  }

  /** Recording a global binding: main drops every grab so the keys reach the window. */
  release(): void {
    this.released = true;
    if (!this.shell || !this.started) return;
    this.lastSent = "[]";
    void this.shell.setGlobalShortcuts([]).catch(() => undefined);
  }

  /** Recording ended: the current list goes to main again. */
  restore(): void {
    this.released = false;
    this.sync();
  }

  status(commandId: string): GlobalStatus | null {
    return this.statuses.get(commandId) ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private send(bindings: GlobalBinding[], key: string): void {
    const shell = this.shell!;
    this.lastSent = key;
    this.statuses.clear();
    // bindings past the cap are never sent, so main cannot answer for them
    for (const binding of this.wanted()) this.statuses.set(binding.commandId, "invalid");
    for (const binding of bindings) this.statuses.set(binding.commandId, "pending");
    this.emit();
    void shell.setGlobalShortcuts(bindings).then(
      (results) => {
        if (this.lastSent !== key) return;
        // main answers [] for a payload it refused as a whole: no answer is a failure, not a wait
        for (const binding of bindings) this.statuses.set(binding.commandId, "invalid");
        for (const result of results) this.statuses.set(result.commandId, result.ok ? "active" : statusFor(result.reason));
        this.emit();
      },
      // stays pending; sent again on the next change or window focus
      () => undefined,
    );
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
