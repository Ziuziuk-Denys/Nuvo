import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, type CommandDefinition } from "./registry";

const command = (id: string, extra: Partial<CommandDefinition> = {}): CommandDefinition => ({
  id,
  labelKey: `label.${id}`,
  group: "playback",
  run: vi.fn(),
  ...extra,
});

function fixture(onSave = vi.fn()) {
  const registry = new CommandRegistry({ strict: true, onSave });
  registry.register(command("player.toggle", { defaultApp: "Space", globalAllowed: true }));
  registry.register(command("player.mute", { defaultApp: "M", globalAllowed: true }));
  registry.register(command("nav.queue", { group: "navigation", defaultApp: "Q" }));
  registry.register(command("library.like-toggle", { group: "library", defaultGlobal: "Alt+Shift+L", globalAllowed: true }));
  registry.register(command("app.palette", { group: "app", defaultApp: "Control+K", globalAllowed: true }));
  return { registry, onSave };
}

describe("CommandRegistry", () => {
  it("uses defaults until changed, clears to none and resets (4.1, test 31)", () => {
    const { registry } = fixture();
    expect(registry.bindingFor("player.mute", "app")).toBe("M");
    expect(registry.setBinding("player.mute", "app", null)).toEqual({ ok: true, accelerator: null });
    expect(registry.bindingFor("player.mute", "app")).toBeNull();
    expect(registry.find("M", "app")).toBeNull();
    registry.resetBinding("player.mute", "app");
    expect(registry.find("M", "app")?.id).toBe("player.mute");
  });

  it("stores only differences from the defaults and saves each change", () => {
    const { registry, onSave } = fixture();
    registry.setBinding("nav.queue", "app", "shift+w");
    expect(registry.snapshot()).toEqual({ version: 1, app: { "nav.queue": "Shift+W" }, global: {} });
    registry.setBinding("nav.queue", "app", "Q");
    expect(registry.snapshot()).toEqual({ version: 1, app: {}, global: {} });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("refuses a binding another command uses in the same scope (test 26)", () => {
    const { registry } = fixture();
    expect(registry.checkCandidate("nav.queue", "app", "M")).toEqual({ ok: false, reason: "conflict", conflictId: "player.mute" });
    expect(registry.checkCandidate("nav.queue", "app", "ctrl+k")).toEqual({ ok: false, reason: "conflict", conflictId: "app.palette" });
  });

  it("refuses a global binding that an in-app binding of another command uses, and the other way round (test 28)", () => {
    const { registry } = fixture();
    expect(registry.checkCandidate("library.like-toggle", "global", "Control+K")).toEqual({ ok: false, reason: "conflict", conflictId: "app.palette" });
    expect(registry.checkCandidate("nav.queue", "app", "Alt+Shift+L")).toEqual({ ok: false, reason: "conflict", conflictId: "library.like-toggle" });
  });

  it("allows the same command its own binding again", () => {
    const { registry } = fixture();
    expect(registry.checkCandidate("player.mute", "app", "m")).toEqual({ ok: true, accelerator: "M" });
  });

  it("applies the global rules: allowed commands, a real modifier or an F key, reserved combinations (test 27)", () => {
    const { registry } = fixture();
    expect(registry.checkCandidate("nav.queue", "global", "Control+Alt+Q")).toEqual({ ok: false, reason: "not-allowed" });
    expect(registry.checkCandidate("library.like-toggle", "global", "L")).toEqual({ ok: false, reason: "needs-modifier" });
    expect(registry.checkCandidate("library.like-toggle", "global", "Shift+L")).toEqual({ ok: false, reason: "needs-modifier" });
    expect(registry.checkCandidate("library.like-toggle", "global", "F9")).toEqual({ ok: true, accelerator: "F9" });
    expect(registry.checkCandidate("library.like-toggle", "global", "Alt+F4")).toEqual({ ok: false, reason: "reserved" });
    expect(registry.checkCandidate("library.like-toggle", "global", "Control+Alt+Delete")).toEqual({ ok: false, reason: "reserved" });
  });

  it("refuses Escape anywhere, Tab alone in the app, and what does not parse", () => {
    const { registry } = fixture();
    expect(registry.checkCandidate("nav.queue", "app", "Escape")).toEqual({ ok: false, reason: "reserved" });
    expect(registry.checkCandidate("nav.queue", "app", "Tab")).toEqual({ ok: false, reason: "tab" });
    expect(registry.checkCandidate("nav.queue", "app", "Control+Tab")).toEqual({ ok: true, accelerator: "Control+Tab" });
    expect(registry.checkCandidate("nav.queue", "app", "Hyper+Q")).toEqual({ ok: false, reason: "invalid" });
  });

  it("gives a newcomer's default to nobody when a custom binding already uses it", () => {
    const { registry } = fixture();
    registry.setBinding("nav.queue", "app", "F");
    registry.register(command("nav.lyrics", { group: "navigation", defaultApp: "F" }));
    expect(registry.bindingFor("nav.lyrics", "app")).toBeNull();
    expect(registry.find("F", "app")?.id).toBe("nav.queue");
  });

  it("keeps stored ids of commands that are not registered yet (test 43)", () => {
    const { registry } = fixture();
    registry.load({ version: 1, app: { "future.thing": "X" }, global: {} });
    registry.setBinding("nav.queue", "app", "W");
    expect(registry.snapshot().app).toEqual({ "future.thing": "X", "nav.queue": "W" });
    expect(registry.find("X", "app")).toBeNull();
  });

  it("drops stored entries that are malformed and writes accelerators canonically", () => {
    const { registry } = fixture();
    const hostile = {
      version: 1,
      app: { "nav.queue": "ctrl+w", "Bad Id": "X", "player.mute": "Hyper+M", "player.toggle": 5, "app.palette": null },
      global: { "library.like-toggle": "" },
    };
    registry.load(hostile as never);
    expect(registry.snapshot()).toEqual({ version: 1, app: { "nav.queue": "Control+W", "app.palette": null }, global: {} });
  });

  it("runs only enabled commands and lists their state (test 39)", () => {
    const registry = new CommandRegistry({ strict: true });
    const off = command("player.next", { enabled: () => false });
    registry.register(off);
    expect(registry.run("player.next", "key")).toBe(false);
    expect(off.run).not.toHaveBeenCalled();
    expect(registry.list()[0]).toMatchObject({ id: "player.next", enabled: false, palette: true, app: null, global: null });
    expect(registry.run("missing", "key")).toBe(false);
  });

  it("throws on a second registration in strict mode and ignores it otherwise", () => {
    const strict = new CommandRegistry({ strict: true });
    strict.register(command("player.toggle"));
    expect(() => strict.register(command("player.toggle"))).toThrow(/twice/);
    const relaxed = new CommandRegistry();
    const first = command("player.toggle");
    relaxed.register(first);
    relaxed.register(command("player.toggle"));
    relaxed.run("player.toggle", "code");
    expect(first.run).toHaveBeenCalledWith("code");
    expect(() => relaxed.register(command("Bad Id"))).toThrow(/command id/);
  });

  it("unregisters and tells listeners", () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const remove = registry.register(command("player.toggle", { defaultApp: "Space" }));
    remove();
    expect(registry.find("Space", "app")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("resets every binding at once", () => {
    const { registry } = fixture();
    registry.setBinding("library.like-toggle", "global", "Alt+Shift+J");
    registry.resetAllBindings();
    expect(registry.bindingFor("library.like-toggle", "global")).toBe("Alt+Shift+L");
  });
});
