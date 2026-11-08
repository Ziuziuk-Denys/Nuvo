/** In-app key presses to commands, with the guards that keep shortcuts out of fields and controls, and the Escape stack. */
import { acceleratorFromEvent, acceleratorKey, isComposing } from "./accelerator";
import type { CommandRegistry } from "./registry";

/** Surfaces that close on Escape push a handler when they open; Escape runs the newest one. */
export class EscapeStack {
  private readonly handlers: Array<() => void> = [];
  private fallback: (() => boolean) | null = null;

  push(handler: () => void): () => void {
    const entry = () => handler();
    this.handlers.push(entry);
    return () => {
      const index = this.handlers.indexOf(entry);
      if (index !== -1) this.handlers.splice(index, 1);
    };
  }

  /** What Escape does with nothing open, for example going back from an entity page. */
  setFallback(fallback: (() => boolean) | null): void {
    this.fallback = fallback;
  }

  /** Runs the newest handler, else the fallback; true when something handled Escape. */
  run(): boolean {
    const top = this.handlers[this.handlers.length - 1];
    if (top) {
      top();
      return true;
    }
    return this.fallback?.() ?? false;
  }
}

export interface KeyHandlerDeps {
  registry: CommandRegistry;
  escape: EscapeStack;
  windowFocused(): boolean;
  /** A dialog or menu is open: it handles keys itself. */
  overlayOpen(): boolean;
  /** Something holds the app's escape guard (a field that handles its own Escape). */
  escapeGuarded(): boolean;
  /** A binding is being recorded: the recorder owns every key, Escape included. */
  recording(): boolean;
}

const NOT_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"]);
const SPACE_TAKERS = new Set(["switch", "checkbox", "radio", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option"]);
const ARROW_TAKERS = new Set([
  "slider",
  "spinbutton",
  "listbox",
  "combobox",
  "option",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tablist",
  "tab",
]);
const ARROWS = new Set(["Up", "Down", "Left", "Right"]);

function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(element.type);
  return element.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function roleOf(element: Element): string | null {
  const role = element.getAttribute("role");
  if (role) return role;
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") return element.type;
    if (element.type === "range") return "slider";
    if (element.type === "number") return "spinbutton";
  }
  return null;
}

export function createKeyHandler(deps: KeyHandlerDeps): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.defaultPrevented || !deps.windowFocused() || deps.recording() || isComposing(event)) return;
    const focus = event.target instanceof Element ? event.target : document.activeElement;
    if (event.key === "Escape") {
      if (deps.overlayOpen() || deps.escapeGuarded() || focus?.closest("[data-own-escape]")) return;
      if (deps.escape.run()) event.preventDefault();
      return;
    }
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator || (focus && isTextField(focus)) || deps.overlayOpen()) return;
    const command = deps.registry.find(accelerator, "app");
    if (!command || (event.repeat && !command.repeatable)) return;
    const key = acceleratorKey(accelerator);
    const role = focus ? roleOf(focus) : null;
    // a focused control that uses Space or the arrows itself keeps them; a plain button does not take Space
    if (role && key === "Space" && SPACE_TAKERS.has(role)) return;
    if (role && ARROWS.has(key) && ARROW_TAKERS.has(role)) return;
    if (deps.registry.run(command.id, "key")) event.preventDefault();
  };
}
