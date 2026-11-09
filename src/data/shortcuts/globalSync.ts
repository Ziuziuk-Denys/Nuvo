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

  bindings(): GlobalBinding[] {
    return this.wanted().slice(0, MAX_GLOBAL_BINDINGS);
  }

  private wanted(): GlobalBinding[] {
    return this.registry.list().flatMap((command) => (command.global && command.globalAllowed ? [{ commandId: command.id, accelerator: command.global }] : []));
  }

  begin(): void {
    this.started = true;
    this.sync();
  }

  // Unchanged lists are not resent: a portal may ask the user each time
  sync(): void {
    if (!this.shell || !this.started || this.released) return;
    const bindings = this.bindings();
    const key = JSON.stringify(bindings);
    if (key !== this.lastSent) this.send(bindings, key);
  }

  retry(): void {
    if (![...this.statuses.values()].includes("pending")) return;
    this.lastSent = null;
    this.sync();
  }

  // Main drops every global grab while recording so the keys reach the window
  release(): void {
    this.released = true;
    if (!this.shell || !this.started) return;
    this.lastSent = "[]";
    void this.shell.setGlobalShortcuts([]).catch(() => undefined);
  }

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
      () => undefined,
    );
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
