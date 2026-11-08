import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, acceleratorKey, formatKeycaps, parseAccelerator, type KeyLike } from "./accelerator";

const press = (code: string, key: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  code,
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

describe("parseAccelerator", () => {
  it("writes modifiers in canonical order and reads the aliases", () => {
    expect(parseAccelerator("shift+ctrl+k")).toBe("Control+Shift+K");
    expect(parseAccelerator("CommandOrControl+Option+Cmd+p")).toBe("Control+Alt+Super+P");
    expect(parseAccelerator("Meta+Enter")).toBe("Super+Return");
  });

  it("reads Plus both ways and Minus as -", () => {
    expect(parseAccelerator("Control++")).toBe("Control+Plus");
    expect(parseAccelerator("Control+Plus")).toBe("Control+Plus");
    expect(parseAccelerator("Control+Minus")).toBe("Control+-");
  });

  it("keeps numpad keys apart and maps Cyrillic letters to their key", () => {
    expect(parseAccelerator("num1")).toBe("num1");
    expect(parseAccelerator("Alt+Shift+д")).toBe("Alt+Shift+L");
    expect(parseAccelerator("ё")).toBe("`");
    expect(parseAccelerator("ґ")).toBe("\\");
  });

  it("refuses what does not parse", () => {
    for (const text of ["", "Control", "Control+", "Hyper+K", "Control+K+J", "x".repeat(65), "F25"]) {
      expect(parseAccelerator(text)).toBeNull();
    }
  });
});

describe("acceleratorFromEvent", () => {
  it("takes the key from its position, whatever the layout (tests 4, 6, 7)", () => {
    expect(acceleratorFromEvent(press("KeyL", "д", { altKey: true, shiftKey: true }))).toBe("Alt+Shift+L");
    expect(acceleratorFromEvent(press("BracketLeft", "х"))).toBe("[");
    expect(acceleratorFromEvent(press("BracketRight", "ъ"))).toBe("]");
    expect(acceleratorFromEvent(press("Backslash", "\\"))).toBe("\\");
    expect(acceleratorFromEvent(press("Slash", "/"))).toBe("/");
    expect(acceleratorFromEvent(press("Slash", "?", { shiftKey: true }))).toBe("Shift+/");
    expect(acceleratorFromEvent(press("ArrowRight", "ArrowRight", { ctrlKey: true }))).toBe("Control+Right");
    expect(acceleratorFromEvent(press("Enter", "Enter"))).toBe("Return");
    expect(acceleratorFromEvent(press("Space", " "))).toBe("Space");
  });

  it("falls back to the character when the code is empty (test 5)", () => {
    expect(acceleratorFromEvent(press("", "Д", { altKey: true, shiftKey: true }))).toBe("Alt+Shift+L");
    expect(acceleratorFromEvent(press("", "q"))).toBe("Q");
    expect(acceleratorFromEvent(press("", " "))).toBe("Space");
  });

  it("keeps the numpad distinct (test 8) and ignores a modifier alone", () => {
    expect(acceleratorFromEvent(press("Numpad1", "1"))).toBe("num1");
    expect(acceleratorFromEvent(press("NumpadEnter", "Enter"))).toBe("numenter");
    expect(acceleratorFromEvent(press("NumpadDivide", "/"))).toBe("numdiv");
    expect(acceleratorFromEvent(press("NumpadDecimal", "."))).toBe("numdec");
    expect(acceleratorFromEvent(press("NumpadMultiply", "*"))).toBe("nummult");
    expect(parseAccelerator("Control+numdiv")).toBe("Control+numdiv");
    expect(acceleratorFromEvent(press("ShiftLeft", "Shift", { shiftKey: true }))).toBeNull();
    expect(acceleratorFromEvent(press("ControlRight", "Control", { ctrlKey: true }))).toBeNull();
  });
});

describe("acceleratorKey", () => {
  it("is the part after the last +", () => {
    expect(acceleratorKey("Control+-")).toBe("-");
    expect(acceleratorKey("Space")).toBe("Space");
    expect(acceleratorKey("Control+Shift+Right")).toBe("Right");
  });
});

describe("formatKeycaps", () => {
  it("shows Ctrl, Alt, Super and arrow glyphs on Linux, symbols on macOS (test 44)", () => {
    expect(formatKeycaps("Control+Alt+Right", "other").map((cap) => cap.text)).toEqual(["Ctrl", "Alt", "→"]);
    expect(formatKeycaps("Control+Alt+Right", "other")[2].label).toBe("Right arrow");
    expect(formatKeycaps("Super+P", "other").map((cap) => cap.text)).toEqual(["Super", "P"]);
    expect(formatKeycaps("Control+Alt+Right", "mac").map((cap) => cap.text)).toEqual(["⌃", "⌥", "→"]);
    expect(formatKeycaps("Super+P", "mac").map((cap) => cap.text)).toEqual(["⌘", "P"]);
    expect(formatKeycaps("num1", "other").map((cap) => cap.text)).toEqual(["Num 1"]);
    expect(formatKeycaps("Return", "other").map((cap) => cap.text)).toEqual(["Enter"]);
    expect(formatKeycaps("nonsense+", "other")).toEqual([]);
  });
});
