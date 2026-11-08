import { describe, expect, it } from "vitest";
import { canPlaceNotch, detectNotchSession, notchEnabled } from "./session";

describe("notch session", () => {
  it("detects sessions from the environment", () => {
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" })).toBe("gnome-wayland");
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland" })).toBe("kde-wayland");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "wayland", HYPRLAND_INSTANCE_SIGNATURE: "x" })).toBe("hyprland");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "wayland", SWAYSOCK: "/run/s" })).toBe("sway");
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "x11" })).toBe("x11");
    expect(detectNotchSession({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" }, true)).toBe("x11");
    expect(detectNotchSession({ XDG_SESSION_TYPE: "wayland" })).toBe("other-wayland");
  });

  it("enables the notch only where it can be placed", () => {
    expect(canPlaceNotch("gnome-wayland")).toBe(false);
    expect(notchEnabled("auto", "kde-wayland")).toBe(true);
    expect(notchEnabled("on", "gnome-wayland")).toBe(false);
    expect(notchEnabled("off", "x11")).toBe(false);
  });
});
