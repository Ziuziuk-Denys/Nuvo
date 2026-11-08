import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { KeyLike } from "./accelerator";
import { GlobalSync, type GlobalBinding, type GlobalResult } from "./globalSync";
import { Recorder, REJECTION_MS } from "./recorder";
import { CommandRegistry, type CommandDefinition } from "./registry";

const command = (id: string, extra: Partial<CommandDefinition>): CommandDefinition => ({ id, labelKey: id, group: "playback", run: () => undefined, ...extra });
const key = (code: string, keyName: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  code,
  key: keyName,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let sent: GlobalBinding[][];
let answer: (bindings: GlobalBinding[]) => GlobalResult[];
let registry: CommandRegistry;
let globals: GlobalSync;
let recorder: Recorder;

beforeEach(() => {
  sent = [];
  answer = (bindings) => bindings.map((binding) => ({ commandId: binding.commandId, ok: true }));
  registry = new CommandRegistry({ strict: true });
  registry.register(command("player.mute", { defaultApp: "M", globalAllowed: true }));
  registry.register(command("nav.queue", { group: "navigation", defaultApp: "Q" }));
  registry.register(command("library.like-toggle", { group: "library", defaultGlobal: "Alt+Shift+L", globalAllowed: true }));
  registry.register(command("app.palette", { group: "app", defaultApp: "Control+K", globalAllowed: true }));
  globals = new GlobalSync(registry, {
    setGlobalShortcuts: async (bindings) => {
      sent.push(bindings);
      return answer(bindings);
    },
  });
  recorder = new Recorder(registry, globals);
});

afterEach(() => vi.useRealTimers());

describe("global registration", () => {
  it("sends nothing before begin, then one list; an unchanged list is not sent again (test 34)", async () => {
    registry.setBinding("player.mute", "app", "N");
    expect(sent).toEqual([]);
    globals.begin();
    registry.setBinding("library.like-toggle", "global", "Alt+Shift+J");
    registry.setBinding("library.like-toggle", "global", "Alt+Shift+J");
    await flush();
    expect(sent).toEqual([
      [{ commandId: "library.like-toggle", accelerator: "Alt+Shift+L" }],
      [{ commandId: "library.like-toggle", accelerator: "Alt+Shift+J" }],
    ]);
    expect(globals.status("library.like-toggle")).toBe("active");
  });

  it("keeps main's refusal as the binding's status (test 33)", async () => {
    answer = (bindings) => bindings.map((binding) => ({ commandId: binding.commandId, ok: false, reason: "taken" }));
    globals.begin();
    expect(globals.status("library.like-toggle")).toBe("pending");
    await flush();
    expect(globals.status("library.like-toggle")).toBe("taken");
  });

  it("re-sends after a reset of every binding (test 32)", async () => {
    globals.begin();
    registry.setBinding("library.like-toggle", "global", "Alt+Shift+J");
    registry.resetAllBindings();
    await flush();
    expect(sent.at(-1)).toEqual([{ commandId: "library.like-toggle", accelerator: "Alt+Shift+L" }]);
    expect(sent).toHaveLength(3);
  });

  it("retries a list main never answered", async () => {
    let calls = 0;
    globals = new GlobalSync(registry, {
      setGlobalShortcuts: (bindings) => {
        calls += 1;
        return calls === 1 ? new Promise(() => undefined) : Promise.resolve(bindings.map((binding) => ({ commandId: binding.commandId, ok: true })));
      },
    });
    globals.begin();
    globals.retry();
    await flush();
    expect(calls).toBe(2);
    expect(globals.status("library.like-toggle")).toBe("active");
  });
});

describe("global status", () => {
  it("marks bindings cut off past the cap, and ones main left unanswered, as invalid", async () => {
    const many = new CommandRegistry({ strict: true });
    for (let n = 0; n < 34; n += 1)
      many.register(command(`player.c${n}`, { defaultGlobal: `Control+Alt+${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[n]}`, globalAllowed: true }));
    const capped = new GlobalSync(many, { setGlobalShortcuts: async () => [] });
    capped.begin();
    await flush();
    const statuses = many.list().map((view) => capped.status(view.id));
    expect(statuses.filter((status) => status === "pending")).toEqual([]);
    expect(statuses.every((status) => status === "invalid")).toBe(true);
  });
});

describe("recorder composition", () => {
  it("ignores input method events while recording", () => {
    recorder.start("player.mute", "app");
    recorder.key({ ...key("Escape", "Escape"), isComposing: true });
    recorder.key({ ...key("KeyP", "Process"), keyCode: 229 });
    expect(recorder.recording).toBe(true);
    expect(registry.bindingFor("player.mute", "app")).toBe("M");
  });
});

describe("recorder", () => {
  beforeEach(() => globals.begin());

  it("Escape cancels without a change (test 24)", () => {
    recorder.start("nav.queue", "app");
    recorder.key(key("Escape", "Escape"));
    expect(recorder.state).toEqual({ kind: "idle" });
    expect(registry.bindingFor("nav.queue", "app")).toBe("Q");
  });

  it("shows held modifiers, then commits the combination (test 25)", () => {
    recorder.start("nav.queue", "app");
    recorder.key(key("ShiftLeft", "Shift", { shiftKey: true }));
    expect(recorder.state).toMatchObject({ kind: "recording", held: ["Shift"] });
    recorder.key(key("KeyW", "W", { shiftKey: true }));
    expect(recorder.state).toEqual({ kind: "idle" });
    expect(registry.bindingFor("nav.queue", "app")).toBe("Shift+W");
  });

  it("refuses a key another command uses and clears the message after 2.5 s (test 26)", () => {
    vi.useFakeTimers();
    recorder.start("nav.queue", "app");
    recorder.key(key("KeyM", "m"));
    expect(recorder.state).toMatchObject({ kind: "recording", rejection: { ok: false, reason: "conflict", conflictId: "player.mute" } });
    vi.advanceTimersByTime(REJECTION_MS);
    expect(recorder.state).toMatchObject({ kind: "recording", rejection: null });
  });

  it("asks a global binding for a modifier, accepts an F key alone (test 27)", () => {
    recorder.start("library.like-toggle", "global");
    recorder.key(key("KeyL", "l"));
    expect(recorder.state).toMatchObject({ rejection: { reason: "needs-modifier" } });
    recorder.key(key("KeyL", "L", { shiftKey: true }));
    expect(recorder.state).toMatchObject({ rejection: { reason: "needs-modifier" } });
    recorder.key(key("F9", "F9"));
    expect(recorder.state).toEqual({ kind: "idle" });
    expect(registry.bindingFor("library.like-toggle", "global")).toBe("F9");
  });

  it("refuses a global key the app uses in-app (test 28)", () => {
    recorder.start("library.like-toggle", "global");
    recorder.key(key("KeyK", "k", { ctrlKey: true }));
    expect(recorder.state).toMatchObject({ rejection: { reason: "conflict", conflictId: "app.palette" } });
  });

  it("releases main's grabs only for a global recording and sends the full list at the end (test 29)", async () => {
    await flush();
    sent = [];
    recorder.start("library.like-toggle", "global");
    recorder.key(key("F9", "F9"));
    await flush();
    expect(sent).toEqual([[], [{ commandId: "library.like-toggle", accelerator: "F9" }]]);
    sent = [];
    recorder.start("nav.queue", "app");
    recorder.key(key("KeyW", "w"));
    await flush();
    expect(sent).toEqual([]);
  });
});
