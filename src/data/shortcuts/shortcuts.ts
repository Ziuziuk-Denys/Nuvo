import { createBindingsClient, DEFAULT_BINDINGS, LEGACY_SHORTCUTS_KEY, migrateLegacyBindings } from "./bindings";
import { GlobalSync, type GlobalShell } from "./globalSync";
import { createKeyHandler, EscapeStack } from "./keys";
import { Recorder } from "./recorder";
import { CommandRegistry, type CommandDefinition } from "./registry";

export interface ShortcutShell extends GlobalShell {
  onAppCommand(callback: (command: { commandId: string }) => void): () => void;
}

export interface ShortcutsDeps {
  base: string;
  fetch: typeof fetch;
  storage(): Storage | null;
  shell: ShortcutShell | null;
  commands: CommandDefinition[];
  overlayOpen(): boolean;
  escapeGuarded(): boolean;
  windowFocused?: () => boolean;
  strict?: boolean;
}

export interface Shortcuts {
  registry: CommandRegistry;
  escape: EscapeStack;
  recorder: Recorder;
  globals: GlobalSync;
  load(): Promise<void>;
  start(): () => void;
}

function safeStorage(read: () => Storage | null): Storage | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function createShortcuts(deps: ShortcutsDeps): Shortcuts {
  const client = createBindingsClient(deps.base, deps.fetch);
  let loaded = false;
  let loading: Promise<void> | null = null;
  // nothing is saved before the stored copy is read: a save then would overwrite every saved binding
  const registry = new CommandRegistry({
    strict: deps.strict,
    onSave: (stored) => {
      if (loaded) void client.save(stored);
    },
  });
  for (const command of deps.commands) registry.register(command);
  const escape = new EscapeStack();
  const globals = new GlobalSync(registry, deps.shell);
  const recorder = new Recorder(registry, globals);
  const dispatch = createKeyHandler({
    registry,
    escape,
    overlayOpen: deps.overlayOpen,
    escapeGuarded: deps.escapeGuarded,
    windowFocused: deps.windowFocused ?? (() => document.hasFocus()),
    recording: () => recorder.recording,
  });

  async function readStored(): Promise<void> {
    const result = await client.load();
    if (result.state === "unavailable") return;
    let bindings = result.bindings;
    if (bindings === null) {
      const storage = safeStorage(deps.storage);
      const migrated = migrateLegacyBindings(storage?.getItem(LEGACY_SHORTCUTS_KEY) ?? null, DEFAULT_BINDINGS);
      if (migrated) {
        // the old key stays until the daemon holds its content
        if (!(await client.save(migrated))) return;
        storage?.removeItem(LEGACY_SHORTCUTS_KEY);
        bindings = migrated;
      }
    }
    loaded = true;
    if (bindings) registry.load(bindings);
  }

  function load(): Promise<void> {
    if (loaded) return Promise.resolve();
    loading ??= readStored().finally(() => {
      loading = null;
    });
    return loading;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (recorder.recording) {
      event.preventDefault();
      recorder.key(event);
      return;
    }
    dispatch(event);
  }

  function start(): () => void {
    const onFocus = () => {
      void load();
      globals.retry();
    };
    const onBlur = () => recorder.stop();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    // player:command (play, next, previous) stays with the engine, which already runs it; only app:command comes here
    const offAppCommand =
      deps.shell?.onAppCommand((command) => {
        if (typeof command?.commandId === "string") registry.run(command.commandId, "global");
      }) ?? null;
    void load().finally(() => globals.begin());
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      offAppCommand?.();
    };
  }

  return { registry, escape, recorder, globals, load, start };
}
