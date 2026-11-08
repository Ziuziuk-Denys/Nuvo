import { describe, expect, it } from "vitest";
import { parseAccelerator } from "../../src/data/shortcuts/accelerator";
import { GLOBAL_COMMAND_IDS, GlobalShortcuts, validAccelerator } from "./shortcuts";

const fake = () => {
  const registered = new Map<string, () => void>();
  return {
    registered,
    register: (accelerator: string, callback: () => void) => !!registered.set(accelerator, callback),
    unregister: (accelerator: string) => void registered.delete(accelerator),
  };
};

describe("validAccelerator", () => {
  it("accepts numpad Enter in a combination and refuses it alone", () => {
    expect(validAccelerator("Control+numenter")).toBe(true);
    expect(validAccelerator("numenter")).toBe(false);
    expect(validAccelerator("Control+numfoo")).toBe(false);
  });

  it("accepts every key the renderer can write", () => {
    const keys = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)];
    keys.push(
      "Space",
      "Tab",
      "Return",
      "Backspace",
      "Delete",
      "Insert",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Up",
      "Down",
      "Left",
      "Right",
      "Plus",
      "-",
      "=",
      "[",
      "]",
      ";",
      "'",
      "`",
      ",",
      ".",
      "/",
      "\\",
    );
    keys.push(...Array.from({ length: 10 }, (_, i) => `num${i}`), "numadd", "numsub", "numenter", "numdec", "nummult", "numdiv");
    for (const key of keys) {
      expect(parseAccelerator(`Control+${key}`), key).toBe(`Control+${key}`);
      expect(validAccelerator(`Control+${key}`), key).toBe(true);
    }
  });
});

describe("GlobalShortcuts enforcement", () => {
  it("refuses commands that may not be global and reserved combinations", () => {
    const shortcuts = fake();
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      () => undefined,
    );
    const results = global.set([
      { commandId: "app.quit", accelerator: "Control+Alt+Q" },
      { commandId: "player.toggle", accelerator: "Control+C" },
      { commandId: "player.next", accelerator: "Alt+Tab" },
      { commandId: "player.previous", accelerator: "Control+Alt+Delete" },
      { commandId: "player.mute", accelerator: "Escape" },
      { commandId: "player.mute", accelerator: "Ctrl+Alt+M" },
    ]);
    expect(results.map((r) => r.reason ?? "ok")).toEqual(["invalid", "invalid", "invalid", "invalid", "invalid", "ok"]);
    expect([...shortcuts.registered.keys()]).toEqual(["Ctrl+Alt+M"]);
  });

  it("allows exactly the playback, library, show and palette commands", () => {
    expect([...GLOBAL_COMMAND_IDS].sort()).toEqual([
      "app.palette",
      "app.show",
      "library.like-toggle",
      "player.mute",
      "player.next",
      "player.previous",
      "player.seek-back",
      "player.seek-forward",
      "player.toggle",
      "player.volume-down",
      "player.volume-up",
    ]);
  });
});
