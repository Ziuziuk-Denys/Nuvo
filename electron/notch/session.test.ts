import { describe, expect, it } from "vitest";
import { canPlaceNotch, clicksPassThrough, detectNotchSession, notchEnabled } from "./session";

describe("notch session", () => {
  it("detects sessions from the environment", () => {
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" })).toBe("gnome-wayland");
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland" })).toBe("kde-wayland");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "wayland", HYPRLAND_INSTANCE_SIGNATURE: "x" })).toBe("hyprland");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "wayland", SWAYSOCK: "/run/s" })).toBe("sway");
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "x11" })).toBe("x11");
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" }, true)).toBe("x11");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "wayland" })).toBe("other-wayland");
    expect(detectNotchSession({}, false, "win32")).toBe("windows");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "x11" }, false, "darwin")).toBe("macos");
  });

  it("enables the notch only where it can be placed", () => {
    expect(canPlaceNotch("gnome-wayland")).toBe(false);
    expect(notchEnabled("auto", "kde-wayland")).toBe(true);
    expect(notchEnabled("on", "gnome-wayland")).toBe(false);
    expect(notchEnabled("off", "x11")).toBe(false);
    expect(notchEnabled("on", "windows")).toBe(true);
    expect(notchEnabled("auto", "macos")).toBe(true);
  });

  it("uses mouse pass-through only where there is no input shape", () => {
    expect(clicksPassThrough("windows")).toBe(true);
    expect(clicksPassThrough("macos")).toBe(true);
    expect(clicksPassThrough("x11")).toBe(false);
    expect(clicksPassThrough("kde-wayland")).toBe(false);
  });
});
