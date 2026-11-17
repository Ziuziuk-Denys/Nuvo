import { describe, expect, it } from "vitest";
import { kwinScript } from "./placement";

describe("notch placement", () => {
  it("generates a KWin script bound to the exact window title", () => {
    const script = kwinScript("Nuvo Notch", { x: 680, y: 0, width: 560, height: 240 }, true);
    expect(script).toContain('window.caption !== "Nuvo Notch"');
    expect(script).toContain('"width":560');
    expect(script).toContain("keepAbove = true");
    expect(script).toContain("workspace.windowAdded.connect(pin)");
  });

  it("stacks like other windows when asked", () => {
    expect(kwinScript("Nuvo Notch", { x: 0, y: 0, width: 560, height: 240 }, false)).toContain("keepAbove = false");
  });
});
