import { describe, expect, it } from "vitest";
import { kwinScript, notchOrigin } from "./placement";

describe("notch placement", () => {
  it("centers on the display and sits flush with its top edge", () => {
    expect(notchOrigin({ x: 0, y: 0, width: 1920, height: 1080 }, 560)).toEqual({ x: 680, y: 0 });
    expect(notchOrigin({ x: 1920, y: -200, width: 2560, height: 1440 }, 560)).toEqual({ x: 2920, y: -200 });
  });

  it("generates a KWin script bound to the exact window title", () => {
    const script = kwinScript("Nuvo Notch", { x: 680, y: 0, width: 560, height: 240 });
    expect(script).toContain('window.caption !== "Nuvo Notch"');
    expect(script).toContain('"width":560');
    expect(script).toContain("keepAbove = true");
    expect(script).toContain("workspace.windowAdded.connect(pin)");
  });
});
