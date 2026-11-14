import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cutoutFor, parseScreens, SCREENS_SCRIPT } from "./cutout";

const builtIn = {
  frame: { x: 0, y: 0, width: 1512, height: 982 },
  left: { x: 0, y: 950, width: 656, height: 32 },
  right: { x: 856, y: 950, width: 656, height: 32 },
};
const external = {
  frame: { x: 1512, y: -458, width: 2560, height: 1440 },
  left: { x: 0, y: 0, width: 0, height: 0 },
  right: { x: 0, y: 0, width: 0, height: 0 },
};

describe("camera cutout", () => {
  it("is the gap between the two top areas of the matching screen", () => {
    expect(cutoutFor([builtIn, external], { x: 0, y: 0, width: 1512, height: 982 })).toEqual({ width: 200, height: 32 });
  });

  it("a screen without a notch has none, found by its flipped origin", () => {
    expect(cutoutFor([builtIn, external], { x: 1512, y: 0, width: 2560, height: 1440 })).toBeNull();
    expect(cutoutFor([builtIn, external], { x: 1512, y: 10, width: 2560, height: 1440 })).toBeNull();
    expect(cutoutFor([], { x: 0, y: 0, width: 1512, height: 982 })).toBeNull();
  });

  it("parses only well formed screens and survives any other output", () => {
    expect(parseScreens(JSON.stringify([builtIn, { frame: null }, { frame: builtIn.frame, left: "x" }]))).toEqual([
      builtIn,
      { frame: builtIn.frame, left: null, right: null },
    ]);
    expect(parseScreens("execution error")).toEqual([]);
    expect(parseScreens('{"frame":1}')).toEqual([]);
  });

  it.runIf(process.platform === "darwin")("osascript reads the real screens", () => {
    const screens = parseScreens(execFileSync("osascript", ["-l", "JavaScript", "-e", SCREENS_SCRIPT], { encoding: "utf8" }));
    expect(screens.length).toBeGreaterThan(0);
    expect(screens[0].frame.width).toBeGreaterThan(0);
    expect(screens[0].left).not.toBeNull();
  });
});
