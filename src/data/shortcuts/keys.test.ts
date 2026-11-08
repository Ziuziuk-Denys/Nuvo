// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKeyHandler, EscapeStack } from "./keys";
import { CommandRegistry, type CommandDefinition } from "./registry";

let ran: string[];
let state: { overlay: boolean; guarded: boolean; focused: boolean; enabled: boolean; recording: boolean };
let escape: EscapeStack;
let handler: (event: KeyboardEvent) => void;

function command(id: string, defaultApp: string, extra: Partial<CommandDefinition> = {}): CommandDefinition {
  return { id, labelKey: id, group: "playback", defaultApp, run: () => ran.push(id), ...extra };
}

beforeEach(() => {
  ran = [];
  state = { overlay: false, guarded: false, focused: true, enabled: true, recording: false };
  const registry = new CommandRegistry({ strict: true });
  registry.register(command("player.toggle", "Space", { enabled: () => state.enabled }));
  registry.register(command("player.next", "Control+Right"));
  registry.register(command("player.seek-back", "Left", { repeatable: true }));
  registry.register(command("player.volume-up", "Up", { repeatable: true }));
  registry.register(command("player.mute", "M"));
  registry.register(command("library.like-toggle", "Alt+Shift+L"));
  registry.register(command("loop.set-a", "["));
  registry.register(command("loop.set-b", "]"));
  registry.register(command("loop.clear", "\\"));
  registry.register(command("nav.search", "/"));
  registry.register(command("player.digit", "1"));
  escape = new EscapeStack();
  handler = createKeyHandler({
    registry,
    escape,
    windowFocused: () => state.focused,
    overlayOpen: () => state.overlay,
    escapeGuarded: () => state.guarded,
    recording: () => state.recording,
  });
  window.addEventListener("keydown", handler);
});

afterEach(() => {
  window.removeEventListener("keydown", handler);
  document.body.innerHTML = "";
});

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function focusable(html: string): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild as HTMLElement;
  element.focus();
  return element;
}

describe("matching", () => {
  it("Space runs player.toggle once and takes the key (test 1)", () => {
    expect(press({ code: "Space", key: " " }).defaultPrevented).toBe(true);
    expect(ran).toEqual(["player.toggle"]);
  });

  it("modifiers must match exactly (tests 2, 3, 7)", () => {
    press({ code: "Space", key: " ", ctrlKey: true });
    press({ code: "ArrowRight", key: "ArrowRight", ctrlKey: true, shiftKey: true });
    press({ code: "Slash", key: "?", shiftKey: true });
    expect(ran).toEqual([]);
    press({ code: "ArrowRight", key: "ArrowRight", ctrlKey: true });
    press({ code: "Slash", key: "/" });
    expect(ran).toEqual(["player.next", "nav.search"]);
  });

  it("works by key position on a Russian layout and by character without a code (tests 4, 5)", () => {
    press({ code: "KeyL", key: "д", altKey: true, shiftKey: true });
    press({ code: "", key: "Д", altKey: true, shiftKey: true });
    expect(ran).toEqual(["library.like-toggle", "library.like-toggle"]);
  });

  it("runs the loop keys (test 6)", () => {
    press({ code: "BracketLeft", key: "[" });
    press({ code: "BracketRight", key: "]" });
    press({ code: "Backslash", key: "\\" });
    expect(ran).toEqual(["loop.set-a", "loop.set-b", "loop.clear"]);
  });

  it("does not fold numpad digits into the main row (test 8)", () => {
    press({ code: "Numpad1", key: "1" });
    expect(ran).toEqual([]);
    press({ code: "Digit1", key: "1" });
    expect(ran).toEqual(["player.digit"]);
  });
});

describe("guards", () => {
  it("ignores keys typed into a text field (test 9)", () => {
    const input = focusable("<input type='text' />");
    press({ code: "Space", key: " " }, input);
    press({ code: "KeyM", key: "m" }, input);
    const editable = focusable("<div contenteditable='true' tabindex='0'></div>");
    press({ code: "KeyM", key: "m" }, editable);
    expect(ran).toEqual([]);
  });

  it("a plain button does not take Space (test 10)", () => {
    const button = focusable("<button>Play</button>");
    press({ code: "Space", key: " " }, button);
    expect(ran).toEqual(["player.toggle"]);
  });

  it("a switch keeps Space and a slider keeps the arrows (test 11)", () => {
    const toggle = focusable("<div role='switch' tabindex='0'></div>");
    press({ code: "Space", key: " " }, toggle);
    const range = focusable("<input type='range' />");
    press({ code: "ArrowLeft", key: "ArrowLeft" }, range);
    expect(ran).toEqual([]);
  });

  it("does nothing while a dialog or menu is open (test 12)", () => {
    state.overlay = true;
    press({ code: "Space", key: " " });
    expect(ran).toEqual([]);
  });

  it("repeats only repeatable commands (test 13)", () => {
    press({ code: "ArrowRight", key: "ArrowRight", ctrlKey: true, repeat: true });
    press({ code: "ArrowUp", key: "ArrowUp", repeat: true });
    expect(ran).toEqual(["player.volume-up"]);
  });

  it("leaves an event alone that something else already handled (test 14)", () => {
    document.body.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    press({ code: "Space", key: " " });
    expect(ran).toEqual([]);
  });

  it("does not take the key when the command is disabled, or the window is not focused", () => {
    state.enabled = false;
    expect(press({ code: "Space", key: " " }).defaultPrevented).toBe(false);
    state.enabled = true;
    state.focused = false;
    press({ code: "Space", key: " " });
    expect(ran).toEqual([]);
  });
});

describe("Escape", () => {
  it("closes the surface opened last first (test 21)", () => {
    const closed: string[] = [];
    const offSearch = escape.push(() => {
      closed.push("search");
      offSearch();
    });
    const offQueue = escape.push(() => {
      closed.push("queue");
      offQueue();
    });
    expect(press({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(true);
    press({ key: "Escape", code: "Escape" });
    expect(closed).toEqual(["queue", "search"]);
  });

  it("leaves Escape to a field that handles its own (test 22) and to an open dialog (test 23)", () => {
    const closed: string[] = [];
    escape.push(() => closed.push("search"));
    const rename = focusable("<div data-own-escape><input /></div>");
    press({ key: "Escape", code: "Escape" }, rename.querySelector("input")!);
    state.overlay = true;
    press({ key: "Escape", code: "Escape" });
    state.overlay = false;
    state.guarded = true;
    press({ key: "Escape", code: "Escape" });
    expect(closed).toEqual([]);
  });

  it("falls back when nothing is open, and does nothing without a fallback", () => {
    expect(press({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(false);
    let backs = 0;
    escape.setFallback(() => {
      backs += 1;
      return true;
    });
    expect(press({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(true);
    expect(backs).toBe(1);
  });
});

describe("recording and composition", () => {
  it("runs no command while a binding is being recorded, and Escape only cancels the recording", () => {
    state.recording = true;
    escape.push(() => ran.push("escape"));
    const space = press({ code: "Space", key: " " });
    const esc = press({ code: "Escape", key: "Escape" });
    expect(ran).toEqual([]);
    expect([space.defaultPrevented, esc.defaultPrevented]).toEqual([false, false]);
    state.recording = false;
    press({ code: "Space", key: " " });
    expect(ran).toEqual(["player.toggle"]);
  });

  it("ignores key events of an input method composition", () => {
    escape.push(() => ran.push("escape"));
    press({ code: "KeyM", key: "m", isComposing: true });
    press({ code: "KeyM", key: "Process", keyCode: 229 });
    press({ code: "Escape", key: "Escape", isComposing: true });
    expect(ran).toEqual([]);
  });
});
