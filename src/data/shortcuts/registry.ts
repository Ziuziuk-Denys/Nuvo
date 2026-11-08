/** One list of commands that keys, global keys, the palette, the tray and the Notch all run. */
import { acceleratorKey, parseAccelerator } from "./accelerator";

export type Scope = "app" | "global";
export type CommandSource = "key" | "global" | "palette" | "tray" | "notch" | "code";
export type CommandGroup = "playback" | "navigation" | "library" | "sound" | "app" | "settings";

export interface CommandDefinition {
  id: string;
  labelKey: string;
  group: CommandGroup;
  defaultApp?: string | null;
  defaultGlobal?: string | null;
  globalAllowed?: boolean;
  repeatable?: boolean;
  /** Listed in the palette; true when left out. */
  palette?: boolean;
  keywords?: string[];
  /** Whether it can run now; always when left out. */
  enabled?: () => boolean;
  run(source: CommandSource): void;
}

export interface CommandView {
  id: string;
  labelKey: string;
  group: CommandGroup;
  keywords: string[];
  palette: boolean;
  globalAllowed: boolean;
  enabled: boolean;
  app: string | null;
  global: string | null;
}

/** What the daemon stores: only the differences from the defaults; null means cleared. */
export interface StoredBindings {
  version: 1;
  app: Record<string, string | null>;
  global: Record<string, string | null>;
}

export type Rejection = "invalid" | "reserved" | "needs-modifier" | "tab" | "not-allowed" | "conflict";
export type BindingResult = { ok: true; accelerator: string | null } | { ok: false; reason: Rejection; conflictId?: string };

const COMMAND_ID = /^[a-z0-9.-]{1,64}$/;
const RESERVED_GLOBAL = new Set(["Alt+Tab", "Alt+F4", "Control+Alt+Delete"]);
/** Keys a global binding may use without a modifier. */
const STANDALONE_GLOBAL = /^F([1-9]|1[0-9]|2[0-4])$/;

const STORED_ID = /^[a-z0-9.-]{1,64}$/;

/** Keeps entries with a well-formed id and a null or parseable accelerator, written canonically. */
function validScope(scope: Record<string, string | null> | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [id, value] of Object.entries(scope ?? {})) {
    if (!STORED_ID.test(id)) continue;
    if (value === null) out[id] = null;
    else if (typeof value === "string" && parseAccelerator(value)) out[id] = parseAccelerator(value);
  }
  return out;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private custom: Record<Scope, Record<string, string | null>> = { app: {}, global: {} };
  private readonly listeners = new Set<() => void>();
  private readonly strict: boolean;
  private readonly onSave: (stored: StoredBindings) => void;

  constructor(options: { strict?: boolean; onSave?: (stored: StoredBindings) => void } = {}) {
    this.strict = options.strict ?? false;
    this.onSave = options.onSave ?? (() => undefined);
  }

  register(definition: CommandDefinition): () => void {
    if (!COMMAND_ID.test(definition.id)) throw new Error(`command id must be 1-64 of a-z, 0-9, "." and "-": ${definition.id}`);
    if (this.commands.has(definition.id)) {
      // a second registration throws in development and is ignored in production
      if (this.strict) throw new Error(`command registered twice: ${definition.id}`);
      return () => undefined;
    }
    this.commands.set(definition.id, definition);
    this.emit();
    return () => {
      if (this.commands.get(definition.id) !== definition) return;
      this.commands.delete(definition.id);
      this.emit();
    };
  }

  command(id: string): CommandDefinition | null {
    return this.commands.get(id) ?? null;
  }

  /** The effective binding: the custom one, none when cleared, else the default. */
  bindingFor(id: string, scope: Scope): string | null {
    const custom = this.custom[scope];
    if (Object.hasOwn(custom, id)) return custom[id];
    const fallback = this.defaultFor(id, scope);
    if (!fallback) return null;
    // another command's custom binding wins over this default
    for (const [other, accelerator] of Object.entries(custom)) {
      if (other !== id && accelerator === fallback && this.commands.has(other)) return null;
    }
    return fallback;
  }

  list(): CommandView[] {
    return [...this.commands.values()].map((command) => ({
      id: command.id,
      labelKey: command.labelKey,
      group: command.group,
      keywords: command.keywords ?? [],
      palette: command.palette ?? true,
      globalAllowed: command.globalAllowed ?? false,
      enabled: command.enabled?.() ?? true,
      app: this.bindingFor(command.id, "app"),
      global: this.bindingFor(command.id, "global"),
    }));
  }

  /** The registered command bound to this canonical accelerator, if any. */
  find(accelerator: string, scope: Scope): CommandDefinition | null {
    for (const command of this.commands.values()) {
      if (this.bindingFor(command.id, scope) === accelerator) return command;
    }
    return null;
  }

  /** Runs the command when it exists and is enabled; true when it ran. */
  run(id: string, source: CommandSource): boolean {
    const command = this.commands.get(id);
    if (!command || !(command.enabled?.() ?? true)) return false;
    command.run(source);
    return true;
  }

  /** Validity and conflicts of a candidate; conflicts compare canonical forms across both scopes. */
  checkCandidate(id: string, scope: Scope, text: string): BindingResult {
    const accelerator = parseAccelerator(text);
    if (!accelerator) return { ok: false, reason: "invalid" };
    const key = acceleratorKey(accelerator);
    if (key === "Escape") return { ok: false, reason: "reserved" };
    if (scope === "global") {
      if (!this.commands.get(id)?.globalAllowed) return { ok: false, reason: "not-allowed" };
      if (RESERVED_GLOBAL.has(accelerator)) return { ok: false, reason: "reserved" };
      const modifiers = accelerator.split("+").slice(0, -1);
      if (!modifiers.some((modifier) => modifier !== "Shift") && !STANDALONE_GLOBAL.test(key)) return { ok: false, reason: "needs-modifier" };
    } else if (accelerator === "Tab") {
      return { ok: false, reason: "tab" };
    }
    const otherScope: Scope = scope === "app" ? "global" : "app";
    for (const other of this.commands.keys()) {
      if (other === id) continue;
      // a global grab would swallow the same in-app key while the window is focused
      if (this.bindingFor(other, scope) === accelerator || this.bindingFor(other, otherScope) === accelerator) {
        return { ok: false, reason: "conflict", conflictId: other };
      }
    }
    return { ok: true, accelerator };
  }

  /** Changes a binding after the checks; null clears it. Saves on success. */
  setBinding(id: string, scope: Scope, text: string | null): BindingResult {
    if (text === null) {
      this.custom[scope] = { ...this.custom[scope], [id]: null };
      this.changed();
      return { ok: true, accelerator: null };
    }
    const result = this.checkCandidate(id, scope, text);
    if (!result.ok) return result;
    const next = { ...this.custom[scope] };
    if (result.accelerator === this.defaultFor(id, scope)) delete next[id];
    else next[id] = result.accelerator;
    this.custom[scope] = next;
    this.changed();
    return result;
  }

  resetBinding(id: string, scope: Scope): void {
    const next = { ...this.custom[scope] };
    delete next[id];
    this.custom[scope] = next;
    this.changed();
  }

  resetAllBindings(): void {
    this.custom = { app: {}, global: {} };
    this.changed();
  }

  /** The daemon's copy; ids of commands not registered yet are kept for later. Does not save. */
  load(stored: StoredBindings): void {
    this.custom = { app: validScope(stored.app), global: validScope(stored.global) };
    this.emit();
  }

  snapshot(): StoredBindings {
    return { version: 1, app: { ...this.custom.app }, global: { ...this.custom.global } };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private defaultFor(id: string, scope: Scope): string | null {
    const command = this.commands.get(id);
    return (scope === "app" ? command?.defaultApp : command?.defaultGlobal) ?? null;
  }

  private changed(): void {
    this.emit();
    this.onSave(this.snapshot());
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
