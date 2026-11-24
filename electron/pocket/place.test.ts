import { expect, it, describe } from "vitest";
import { kwinAboveScript, pocketBounds, pocketTop, remembersPlace, validPlace } from "./place";

const SCREEN = { x: 0, y: 0, width: 1600, height: 1000 };

describe("pocketBounds", () => {
  it("starts in the bottom right corner, the drawn shadow outside the gap", () => {
    expect(pocketBounds(null, [SCREEN], SCREEN, 10)).toEqual({ x: 1600 - 300 - 24 - 10, y: 1000 - 300 - 24 - 10, width: 320, height: 320 });
  });

  it("returns to its saved place while a screen still shows it", () => {
    expect(pocketBounds({ size: 240, x: 40, y: 60 }, [SCREEN], SCREEN, 0)).toEqual({ x: 40, y: 60, width: 240, height: 240 });
    const gone = pocketBounds({ size: 240, x: 2400, y: 60 }, [SCREEN], SCREEN, 0);
    expect(gone).toEqual({ x: 1600 - 240 - 24, y: 1000 - 240 - 24, width: 240, height: 240 });
  });
});

describe("validPlace", () => {
  it("clamps the size and drops half a position", () => {
    expect(validPlace({ size: 9000, x: 1.4, y: 2.6 })).toEqual({ size: 420, x: 1, y: 3 });
    expect(validPlace({ size: 10, x: 5 })).toEqual({ size: 220 });
    for (const bad of [null, undefined, "x", {}, { size: "300" }, { size: Number.NaN }]) expect(validPlace(bad)).toBeNull();
  });
});

describe("what a desktop allows", () => {
  it("is told apart per session", () => {
    expect(pocketTop("gnome-wayland")).toBe("window-menu");
    expect(pocketTop("other-wayland")).toBe("none");
    for (const session of ["x11", "windows", "macos", "kde-wayland", "hyprland", "sway"] as const) expect(pocketTop(session)).toBe("app");
    expect(remembersPlace("kde-wayland")).toBe(false);
    expect(remembersPlace("windows")).toBe(true);
  });

  it("the KWin script matches the title only and carries the choice", () => {
    const script = kwinAboveScript('Nuvo "Pocket"', false);
    expect(script).toContain('window.caption !== "Nuvo \\"Pocket\\""');
    expect(script).toContain("window.keepAbove = false");
  });
});
